import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { DownloadJob, JobStatus } from "@vidyoza/shared";
import { detectPlatform, isTerminalStatus } from "@vidyoza/shared";
import type { Download } from "../generated/prisma/client";
import * as fs from "fs/promises";
import { join } from "path";
import { AppConfigService } from "../config/app-config.service";
import { ApiException, ErrorCode } from "../common/errors";
import { contentTypeFor, sanitizeFilename } from "../common/utils/filename";
import { ExtractionService } from "../engine/extraction.service";
import { CancelledError } from "../engine/ytdlp.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ValidatedKey } from "../auth/api-key.service";
import type { SessionUser } from "../auth/auth-session.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { CreateDownloadDto } from "./dto/create-download.dto";
import { JobEventsService } from "./job-events.service";
import { JobQueue } from "./job-queue";
import { StorageService } from "../storage/storage.service";
import { QuotaExceededError, StorageQuotaService } from "../storage/storage-quota.service";

const MAX_PENDING_JOBS = 50;

/** Who is asking — determines duration limits and attribution. */
export interface Principal {
  apiKey?: ValidatedKey;
  user?: SessionUser | null;
}

@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ExtractionService,
    private readonly queue: JobQueue,
    private readonly events: JobEventsService,
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  /** The duration cap for a request: API key > signed-in user > anonymous. */
  private durationLimit(principal: Principal): number {
    if (principal.apiKey) return principal.apiKey.maxDurationSeconds;
    if (principal.user) return this.config.authMaxDurationSeconds;
    return this.config.maxDurationSeconds;
  }

  private assertDuration(durationSeconds: number | null, principal: Principal): void {
    const limit = this.durationLimit(principal);
    if (!durationSeconds || durationSeconds <= limit) return;

    const mins = Math.round(durationSeconds / 60);
    const limitMins = Math.round(limit / 60);
    const anonymous = !principal.apiKey && !principal.user;
    const message = anonymous
      ? `This media is ${mins} min long — the guest limit is ${limitMins} min. Sign in (free) to download videos up to ${Math.round(this.config.authMaxDurationSeconds / 60)} min.`
      : `Media duration (${mins} min) exceeds your limit of ${limitMins} min.`;

    throw new ApiException(ErrorCode.DURATION_LIMIT_EXCEEDED, message, HttpStatus.FORBIDDEN, {
      requiresAuth: anonymous,
      durationSeconds,
      limitSeconds: limit,
      authLimitSeconds: this.config.authMaxDurationSeconds,
    });
  }

  async create(dto: CreateDownloadDto, principal: Principal = {}): Promise<DownloadJob> {
    const platform = detectPlatform(dto.url);
    if (!platform) {
      throw new ApiException(
        ErrorCode.UNSUPPORTED_PLATFORM,
        "This URL does not belong to a supported platform (YouTube, Instagram, TikTok, X/Twitter, Facebook).",
      );
    }

    if (this.queue.size >= MAX_PENDING_JOBS) {
      throw new ApiException(
        ErrorCode.QUEUE_FULL,
        "The download queue is full right now. Please try again in a minute.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (dto.clipStart != null && dto.clipEnd != null && dto.clipEnd <= dto.clipStart) {
      throw new ApiException(ErrorCode.INVALID_URL, "clipEnd must be greater than clipStart.");
    }

    // Duration gate before the job exists — the client gets an immediate,
    // typed rejection instead of watching a queued job fail. The info call is
    // effectively free in the normal flow: the frontend fetched (and cached)
    // it moments earlier.
    try {
      const info = await this.extraction.getMediaInfo(dto.url);
      this.assertDuration(info.durationSeconds, principal);
    } catch (error) {
      if (error instanceof ApiException) throw error;
      // Extraction hiccups are not fatal here; the job pipeline retries and
      // reports them properly.
    }

    const record = await this.prisma.download.create({
      data: {
        url: dto.url,
        platform,
        kind: dto.kind,
        status: "QUEUED",
        quality: dto.quality ?? (dto.kind === "video" ? "highest" : "best"),
        format: dto.format ?? (dto.kind === "video" ? "mp4" : "mp3"),
        apiKeyId: principal.apiKey?.id ?? null,
        userId: principal.user?.id ?? null,
      },
    });

    this.events.emit(record.id, { type: "status", status: "QUEUED" });
    this.queue.enqueue(record.id, () => this.runJob(record.id, dto, principal));

    return this.toJob(record);
  }

  /**
   * Queues one job per URL.
   *
   * Deliberately skips `create`'s pre-flight duration probe: that costs one
   * extraction per URL, which would turn a 50-video request into a two-minute
   * hang before the first byte moves. Every job re-checks duration in
   * `runJob` before downloading, so the limit is still enforced — it just
   * surfaces per row instead of rejecting the whole batch. Clients list
   * durations up front and can warn before submitting.
   */
  async createBatch(dto: CreateBatchDto, principal: Principal = {}): Promise<DownloadJob[]> {
    // De-duplicate while preserving order: playlists repeat videos more often
    // than you would expect, and paying twice for one file helps nobody.
    const urls = [...new Set(dto.urls.map((u) => u.trim()).filter(Boolean))];

    const unsupported = urls.find((u) => !detectPlatform(u));
    if (unsupported) {
      throw new ApiException(
        ErrorCode.UNSUPPORTED_PLATFORM,
        `Unsupported URL in batch: ${unsupported}`,
      );
    }

    const headroom = MAX_PENDING_JOBS - this.queue.size;
    if (urls.length > headroom) {
      throw new ApiException(
        ErrorCode.QUEUE_FULL,
        headroom > 0
          ? `Only ${headroom} more download${headroom === 1 ? "" : "s"} can be queued right now — you asked for ${urls.length}. Try a smaller selection.`
          : "The download queue is full right now. Please try again in a minute.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const jobs: DownloadJob[] = [];
    for (const url of urls) {
      const item: CreateDownloadDto = {
        url,
        kind: dto.kind,
        quality: dto.quality,
        format: dto.format,
        embedThumbnail: dto.kind === "audio" ? (dto.embedThumbnail ?? true) : undefined,
      };

      const record = await this.prisma.download.create({
        data: {
          url,
          platform: detectPlatform(url)!,
          kind: dto.kind,
          status: "QUEUED",
          quality: dto.quality ?? (dto.kind === "video" ? "highest" : "best"),
          format: dto.format ?? (dto.kind === "video" ? "mp4" : "mp3"),
          apiKeyId: principal.apiKey?.id ?? null,
          userId: principal.user?.id ?? null,
        },
      });

      this.events.emit(record.id, { type: "status", status: "QUEUED" });
      this.queue.enqueue(record.id, () => this.runJob(record.id, item, principal));
      jobs.push(this.toJob(record));
    }

    this.logger.log(`Batch queued: ${jobs.length} job(s)`);
    return jobs;
  }

  async get(id: string): Promise<DownloadJob> {
    const record = await this.prisma.download.findUnique({ where: { id } });
    if (!record) {
      throw new ApiException(ErrorCode.JOB_NOT_FOUND, "Download not found", HttpStatus.NOT_FOUND);
    }
    return this.toJob(record);
  }

  /** Bulk status read, in the order asked. Unknown ids are simply absent. */
  async getMany(ids: string[]): Promise<DownloadJob[]> {
    const wanted = [...new Set(ids)].slice(0, 100);
    if (wanted.length === 0) return [];

    const records = await this.prisma.download.findMany({ where: { id: { in: wanted } } });
    const byId = new Map(records.map((r) => [r.id, r]));
    return wanted.flatMap((id) => {
      const record = byId.get(id);
      return record ? [this.toJob(record)] : [];
    });
  }

  async cancel(id: string): Promise<DownloadJob> {
    const record = await this.prisma.download.findUnique({ where: { id } });
    if (!record) {
      throw new ApiException(ErrorCode.JOB_NOT_FOUND, "Download not found", HttpStatus.NOT_FOUND);
    }
    if (isTerminalStatus(record.status as JobStatus)) {
      throw new ApiException(
        ErrorCode.JOB_NOT_CANCELLABLE,
        `Download is already ${record.status.toLowerCase()}.`,
        HttpStatus.CONFLICT,
      );
    }

    this.queue.cancel(id);
    const updated = await this.prisma.download.update({
      where: { id },
      data: { status: "CANCELLED", error: "Cancelled by user" },
    });
    this.events.finish(id, { type: "error", message: "Download cancelled", code: "CANCELLED" });
    return this.toJob(updated);
  }

  events$(id: string) {
    return this.events.stream(id);
  }

  /** Full lifecycle of one download job. Runs inside the queue. */
  private async runJob(
    jobId: string,
    dto: CreateDownloadDto,
    principal: Principal,
  ): Promise<void> {
    if (this.queue.wasCancelled(jobId)) return;

    const fail = async (message: string) => {
      await this.update(jobId, { status: "FAILED", error: message });
      this.events.finish(jobId, { type: "error", message });
    };

    try {
      await this.update(jobId, { status: "FETCHING_INFO" });
      this.events.emit(jobId, { type: "status", status: "FETCHING_INFO" });

      const info = await this.extraction.getMediaInfo(dto.url);

      if (info.isLive) {
        await fail("Live streams cannot be downloaded until they finish.");
        return;
      }

      // Backstop for the create-time gate (e.g. extraction failed there).
      const maxDuration = this.durationLimit(principal);
      if (info.durationSeconds && info.durationSeconds > maxDuration) {
        await fail(
          `Media duration (${Math.round(info.durationSeconds / 60)} min) exceeds the allowed limit of ${Math.round(maxDuration / 60)} min.`,
        );
        return;
      }

      if (this.queue.wasCancelled(jobId)) return;

      const format = (dto.format ?? (dto.kind === "video" ? "mp4" : "mp3")) as string;
      const quality = (dto.quality ?? (dto.kind === "video" ? "highest" : "best")) as string;
      const base = `${sanitizeFilename(info.title, 80)} [${quality}] ${jobId.slice(0, 8)}`;
      const expectedFilename = `${base}.${format}`;

      await fs.mkdir(this.config.downloadsDir, { recursive: true });
      // %(ext)s lets yt-dlp pick the container during download; post-processors
      // remux/convert it to the requested format keeping the same basename.
      const outputTemplate = join(this.config.downloadsDir, `${base}.%(ext)s`);

      await this.update(jobId, {
        status: "DOWNLOADING",
        title: info.title,
        thumbnail: info.thumbnail,
        filename: expectedFilename,
      });
      this.events.emit(jobId, { type: "status", status: "DOWNLOADING" });

      let lastDbUpdate = 0;
      try {
        await this.extraction.runDownload({
          url: dto.url,
          request: { ...dto },
          outputPath: outputTemplate,
          // The direct-download fallback has no output template to interpret,
          // so it needs the container and kind spelled out.
          kind: dto.kind,
          format,
          // Each retry spawns a fresh process; re-register so a cancel that
          // lands mid-ladder kills the one actually running.
          onProcess: (child) => this.queue.registerProcess(jobId, child),
          isCancelled: () => this.queue.wasCancelled(jobId),
          onRetry: ({ attempt, total, reason }) => {
            this.logger.warn(`Job ${jobId} retrying (${attempt}/${total}): ${reason}`);
            // The bar restarts with the new process; say so rather than letting
            // it silently snap backwards.
            this.events.emit(jobId, { type: "status", status: "DOWNLOADING" });
          },
          onProgress: (p) => {
            this.events.emit(jobId, {
              type: "progress",
              status: "DOWNLOADING",
              percentage: p.percentage,
              downloadedBytes: p.downloadedBytes,
              totalBytes: p.totalBytes,
              speed: p.speed,
              eta: p.eta,
            });
            const now = Date.now();
            if (now - lastDbUpdate > 1500) {
              lastDbUpdate = now;
              void this.update(jobId, { progress: p.percentage }).catch(() => undefined);
            }
          },
        });
      } finally {
        this.queue.releaseProcess(jobId);
      }

      if (this.queue.wasCancelled(jobId)) {
        await this.cleanupPartials(base);
        return;
      }

      const finalFilename = await this.resolveFinalFile(base, expectedFilename);
      if (!finalFilename) {
        await fail("Download finished but the output file could not be located.");
        return;
      }

      const localPath = join(this.config.downloadsDir, finalFilename);
      const stat = await fs.stat(localPath);
      const expiresAt = new Date(Date.now() + this.config.fileTtlMinutes * 60 * 1000);

      // Offload before marking COMPLETED: a link is only worth handing out once
      // the bytes are somewhere that outlives this container. An upload that
      // fails leaves the local copy in place, and FilesService still serves it.
      const storageKey = await this.offload(jobId, localPath, finalFilename, stat.size);

      const record = await this.update(jobId, {
        status: "COMPLETED",
        filename: finalFilename,
        storageKey,
        fileSizeBytes: BigInt(stat.size),
        progress: 100,
        completedAt: new Date(),
        expiresAt,
        error: null,
      });

      this.events.finish(jobId, { type: "complete", job: this.toJob(record) });
      this.logger.log(`Job ${jobId} completed: ${finalFilename}`);
    } catch (error) {
      if (error instanceof CancelledError || this.queue.wasCancelled(jobId)) {
        this.logger.log(`Job ${jobId} cancelled`);
        const record = await this.prisma.download.findUnique({ where: { id: jobId } });
        if (record?.filename) {
          await this.cleanupPartials(record.filename.replace(/\.[^.]+$/, ""));
        }
        return;
      }
      const message = error instanceof Error ? error.message : "Download failed.";
      this.logger.warn(`Job ${jobId} failed: ${message}`);
      await fail(message);
    }
  }

  /**
   * Moves a finished file into object storage.
   *
   * Returns the object key, or null when the file stays on disk — either
   * because no bucket is configured or because the upload failed. Failure is
   * deliberately not fatal: the user's download is already on this machine and
   * still servable, so a storage outage should cost durability, not the job.
   */
  private async offload(
    jobId: string,
    localPath: string,
    filename: string,
    size: number,
  ): Promise<string | null> {
    if (!this.storage.remote) return null;

    // Claim space first. The reservation is serialised across workers, so two
    // jobs finishing together cannot both decide there is room for the last
    // slot — which is the only way the bucket could exceed its free tier.
    let reservation;
    try {
      reservation = await this.quota.reserve(jobId, filename, size);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        this.logger.warn(`Job ${jobId}: ${error.message} Serving from local disk instead.`);
        return null;
      }
      throw error;
    }

    // Evicted objects are deleted only now, after the reservation committed —
    // an object delete cannot be rolled back, so it must never run for a
    // transaction that might still abort.
    for (const key of reservation.evicted) {
      await this.storage.delete(key).catch((err) =>
        this.logger.warn(`Could not delete evicted object ${key}: ${err.message}`),
      );
    }
    if (reservation.evicted.length) {
      this.logger.log(
        `Evicted ${reservation.evicted.length} expired download(s) to stay within the storage quota`,
      );
    }

    try {
      await this.storage.upload(localPath, filename, contentTypeFor(filename));
      await this.storage.discardLocal(localPath);
      return filename;
    } catch (error) {
      // Hand the reserved space straight back; the file stays on local disk
      // and FilesService keeps serving it from there.
      await this.quota.release(jobId);
      this.logger.warn(
        `Job ${jobId}: upload to storage failed, serving from local disk instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** yt-dlp may output a different container than expected — locate the real file. */
  private async resolveFinalFile(
    base: string,
    expectedFilename: string,
  ): Promise<string | null> {
    const dir = this.config.downloadsDir;
    try {
      await fs.access(join(dir, expectedFilename));
      return expectedFilename;
    } catch {
      // fall through to directory scan
    }
    try {
      const files = await fs.readdir(dir);
      const match = files.find(
        (f) => f.startsWith(base) && !f.endsWith(".part") && !f.endsWith(".ytdl"),
      );
      return match ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Removes the leftovers of a cancelled or failed job.
   *
   * Retried because cleanup races the process that was just killed: on Windows
   * an unlink of a file the dying worker still holds open fails outright, and a
   * single best-effort pass would leave a half-downloaded file on disk forever
   * — invisible to the TTL sweeper, which only knows about completed rows.
   */
  private async cleanupPartials(base: string): Promise<void> {
    const dir = this.config.downloadsDir;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      let remaining = 0;
      try {
        const files = (await fs.readdir(dir)).filter((f) => f.startsWith(base));
        if (files.length === 0) return;
        for (const file of files) {
          try {
            await fs.unlink(join(dir, file));
          } catch {
            remaining++;
          }
        }
      } catch {
        return; // directory is gone — nothing to clean
      }
      if (remaining === 0) return;
    }
    this.logger.warn(`Could not remove all partial files for ${base}`);
  }

  private update(id: string, data: Record<string, unknown>) {
    return this.prisma.download.update({ where: { id }, data });
  }

  toJob(record: Download): DownloadJob {
    return {
      id: record.id,
      platform: record.platform as DownloadJob["platform"],
      url: record.url,
      kind: record.kind as DownloadJob["kind"],
      status: record.status as JobStatus,
      title: record.title,
      thumbnail: record.thumbnail,
      quality: record.quality,
      format: record.format,
      filename: record.filename,
      fileUrl:
        record.status === "COMPLETED" && record.filename
          ? `/v2/files/${encodeURIComponent(record.filename)}`
          : null,
      fileSizeBytes: record.fileSizeBytes != null ? Number(record.fileSizeBytes) : null,
      error: record.error,
      progress: record.progress,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
    };
  }
}
