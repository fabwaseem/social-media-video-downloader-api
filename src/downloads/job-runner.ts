import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { JobStatus } from "@downloader/shared";
import { isTerminalStatus } from "@downloader/shared";
import * as fs from "fs/promises";
import { join } from "path";
import { AppConfigService } from "../config/app-config.service";
import { contentTypeFor, sanitizeFilename } from "../common/utils/filename";
import { ErrorCode } from "../common/errors";
import { ExtractionService } from "../engine/extraction.service";
import { CancelledError } from "../engine/ytdlp.service";
import { classifyYtdlpFailure, EngineError } from "../engine/ytdlp/errors";
import { MetricsService } from "../metrics/metrics.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { QuotaExceededError, StorageQuotaService } from "../storage/storage-quota.service";
import type { Download } from "../generated/prisma/client";
import { CreateDownloadDto } from "./dto/create-download.dto";
import { JobEventsService } from "./job-events.service";
import { readJobOptions } from "./job-options";
import { JobQueue } from "./job-queue";
import { recoveryPlan } from "./job-recovery";
import { ACTIVE_JOB_STATUSES } from "./job-recovery";
import { toDownloadJob } from "./present";
import { postWebhook } from "./webhook";

@Injectable()
export class JobRunner implements OnModuleInit {
  private readonly logger = new Logger(JobRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ExtractionService,
    private readonly queue: JobQueue,
    private readonly events: JobEventsService,
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.queue.setHandler((jobId) => this.run(jobId));
    void this.recover().catch((error: unknown) => {
      this.logger.error(`Could not resume interrupted jobs: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async recover(): Promise<void> {
    const rows = await this.prisma.download.findMany({
      where: { status: { in: [...ACTIVE_JOB_STATUSES] } },
    });
    for (const row of rows) {
      const plan = recoveryPlan(row.status, await this.queue.holds(row.id));
      if (plan === "skip") continue;
      if (row.status !== "QUEUED") {
        await this.prisma.download.update({
          where: { id: row.id },
          data: { status: "QUEUED", progress: 0, error: null, errorCode: null },
        });
        this.events.emit(row.id, { type: "status", status: "QUEUED" });
      }
      await this.queue.enqueue(row.id);
      this.logger.warn(`Resumed job ${row.id} after restart (was ${row.status})`);
    }
  }

  private async run(jobId: string): Promise<void> {
    if (this.queue.wasCancelled(jobId)) return;
    const record = await this.prisma.download.findUnique({ where: { id: jobId } });
    if (!record || isTerminalStatus(record.status as JobStatus)) return;

    const options = readJobOptions(record.options);
    const dto: CreateDownloadDto = {
      url: record.url,
      kind: record.kind === "audio" ? "audio" : "video",
      quality: (record.quality ?? undefined) as CreateDownloadDto["quality"],
      format: (record.format ?? undefined) as CreateDownloadDto["format"],
      embedThumbnail: options.embedThumbnail,
      embedMetadata: options.embedMetadata,
      embedChapters: options.embedChapters,
      embedSubtitles: options.embedSubtitles,
      writeSubtitles: options.writeSubtitles,
      writeThumbnail: options.writeThumbnail,
      videoCodec: options.videoCodec,
      subtitleLang: options.subtitleLang,
      clipStart: options.clipStart,
      clipEnd: options.clipEnd,
      callbackUrl: options.callbackUrl,
    };
    const maxDuration = options.maxDurationSeconds ?? this.config.maxDurationSeconds;

    const fail = async (message: string, code: string) => {
      await this.update(jobId, { status: "FAILED", error: message, errorCode: code });
      this.events.finish(jobId, { type: "error", message, code });
      this.metrics.recordJob("failed", record.platform);
    };

    try {
      await this.update(jobId, { status: "FETCHING_INFO" });
      this.events.emit(jobId, { type: "status", status: "FETCHING_INFO" });

      const info = await this.extraction.getMediaInfo(dto.url);
      if (info.isLive) {
        await fail("Live streams cannot be downloaded until they finish.", ErrorCode.LIVE_STREAM_UNSUPPORTED);
        return;
      }
      if (info.durationSeconds && info.durationSeconds > maxDuration) {
        await fail(
          `Media duration (${Math.round(info.durationSeconds / 60)} min) exceeds the allowed limit of ${Math.round(maxDuration / 60)} min.`,
          ErrorCode.DURATION_LIMIT_EXCEEDED,
        );
        return;
      }
      if (this.queue.wasCancelled(jobId)) return;

      const format = (dto.format ?? (dto.kind === "video" ? "mp4" : "mp3")) as string;
      const quality = (dto.quality ?? (dto.kind === "video" ? "highest" : "best")) as string;
      const base = `${sanitizeFilename(info.title, 80)} [${quality}] ${jobId.slice(0, 8)}`;
      const expectedFilename = `${base}.${format}`;

      await fs.mkdir(this.config.downloadsDir, { recursive: true });
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
          kind: dto.kind,
          format,
          onProcess: (child) => this.queue.registerProcess(jobId, child),
          isCancelled: () => this.queue.wasCancelled(jobId),
          onRetry: ({ attempt, total, reason }) => {
            this.logger.warn(`Job ${jobId} retrying (${attempt}/${total}): ${reason}`);
            this.events.emit(jobId, { type: "status", status: "DOWNLOADING" });
          },
          onProgress: (progress) => {
            this.events.emit(jobId, {
              type: "progress",
              status: "DOWNLOADING",
              percentage: progress.percentage,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speed: progress.speed,
              eta: progress.eta,
            });
            const now = Date.now();
            if (now - lastDbUpdate > 1500) {
              lastDbUpdate = now;
              void this.update(jobId, { progress: progress.percentage }).catch(() => undefined);
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
        await fail("Download finished but the output file could not be located.", ErrorCode.EXTRACTION_FAILED);
        return;
      }

      const localPath = join(this.config.downloadsDir, finalFilename);
      const stat = await fs.stat(localPath);
      const expiresAt = new Date(Date.now() + this.config.fileTtlMinutes * 60 * 1000);
      const storageKey = await this.offload(jobId, localPath, finalFilename, stat.size);
      const updated = await this.update(jobId, {
        status: "COMPLETED",
        filename: finalFilename,
        storageKey,
        fileSizeBytes: BigInt(stat.size),
        progress: 100,
        completedAt: new Date(),
        expiresAt,
        error: null,
        errorCode: null,
      });
      this.events.finish(jobId, {
        type: "complete",
        job: toDownloadJob(updated, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds),
      });
      this.metrics.recordJob("completed", record.platform);
      this.logger.log(`Job ${jobId} completed: ${finalFilename}`);
      await this.notify(options.callbackUrl, toDownloadJob(updated, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds));
    } catch (error) {
      if (error instanceof CancelledError || this.queue.wasCancelled(jobId)) {
        this.logger.log(`Job ${jobId} cancelled`);
        const current = await this.prisma.download.findUnique({ where: { id: jobId } });
        if (current?.filename) await this.cleanupPartials(current.filename.replace(/\.[^.]+$/, ""));
        return;
      }
      const classified = error instanceof EngineError ? error : classifyYtdlpFailure(error);
      this.logger.warn(`Job ${jobId} failed: ${classified.message}`);
      await fail(classified.message, classified.code);
      const failed = await this.prisma.download.findUnique({ where: { id: jobId } });
      if (failed) {
        await this.notify(options.callbackUrl, toDownloadJob(failed, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds));
      }
    }
  }

  private async offload(jobId: string, localPath: string, filename: string, size: number): Promise<string | null> {
    if (!this.storage.remote) return null;
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
    for (const key of reservation.evicted) {
      await this.storage.delete(key).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not delete evicted object ${key}: ${message}`);
      });
    }
    if (reservation.evicted.length) {
      this.logger.log(`Evicted ${reservation.evicted.length} expired download(s) to stay within the storage quota`);
    }
    try {
      await this.storage.upload(localPath, filename, contentTypeFor(filename));
      await this.storage.discardLocal(localPath);
      return filename;
    } catch (error) {
      await this.quota.release(jobId);
      this.logger.warn(
        `Job ${jobId}: upload to storage failed, serving from local disk instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async resolveFinalFile(base: string, expectedFilename: string): Promise<string | null> {
    const dir = this.config.downloadsDir;
    try {
      await fs.access(join(dir, expectedFilename));
      return expectedFilename;
    } catch {
      // fall through to a directory scan
    }
    try {
      const files = await fs.readdir(dir);
      return files.find((file) => file.startsWith(base) && !file.endsWith(".part") && !file.endsWith(".ytdl")) ?? null;
    } catch {
      return null;
    }
  }

  private async cleanupPartials(base: string): Promise<void> {
    const dir = this.config.downloadsDir;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400));
      let remaining = 0;
      try {
        const files = (await fs.readdir(dir)).filter((file) => file.startsWith(base));
        if (files.length === 0) return;
        for (const file of files) {
          try {
            await fs.unlink(join(dir, file));
          } catch {
            remaining++;
          }
        }
      } catch {
        return;
      }
      if (remaining === 0) return;
    }
    this.logger.warn(`Could not remove all partial files for ${base}`);
  }

  private async notify(url: string | undefined, job: ReturnType<typeof toDownloadJob>): Promise<void> {
    if (!url) return;
    try {
      await postWebhook(url, { event: job.status === "COMPLETED" ? "download.completed" : "download.failed", job }, this.config.webhookSecret);
    } catch (error) {
      this.logger.warn(`Webhook for ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private update(id: string, data: Record<string, unknown>): Promise<Download> {
    return this.prisma.download.update({ where: { id }, data });
  }
}
