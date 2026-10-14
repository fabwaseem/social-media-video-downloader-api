import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { DownloadJob, JobStatus } from "@snagbox/shared";
import { isTerminalStatus, resolvePlatform } from "@snagbox/shared";
import { SsrfError, assertPublicHttpUrl } from "../common/http/safe-fetch";
import { Prisma } from "../generated/prisma/client";
import { AppConfigService } from "../config/app-config.service";
import { ApiException, ErrorCode } from "../common/errors";
import { EngineError } from "../engine/ytdlp/errors";
import { ExtractionService } from "../engine/extraction.service";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import type { ValidatedKey } from "../auth/api-key.service";
import type { SessionUser } from "../auth/auth-session.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { CreateDownloadDto } from "./dto/create-download.dto";
import { JobEventsService } from "./job-events.service";
import { jobOptionsFromDto } from "./job-options";
import { JobQueue } from "./job-queue";
import { toDownloadJob } from "./present";

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
    private readonly metrics: MetricsService,
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

  private platformFor(url: string): string {
    if (this.config.allowGenericUrls) {
      try {
        assertPublicHttpUrl(url);
      } catch (error) {
        const message = error instanceof SsrfError ? error.message : "This URL is not allowed.";
        throw new ApiException(ErrorCode.INVALID_URL, message);
      }
    }
    const platform = resolvePlatform(url, this.config.allowGenericUrls);
    if (!platform) {
      throw new ApiException(
        ErrorCode.UNSUPPORTED_PLATFORM,
        "This URL is not a supported platform. Set ALLOW_GENERIC_URLS=true to download any public site yt-dlp supports.",
      );
    }
    return platform;
  }

  async create(dto: CreateDownloadDto, principal: Principal = {}): Promise<DownloadJob> {
    const platform = this.platformFor(dto.url);

    if ((await this.queue.pendingCount()) >= MAX_PENDING_JOBS) {
      throw new ApiException(
        ErrorCode.QUEUE_FULL,
        "The download queue is full right now. Please try again in a minute.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (dto.clipStart != null && dto.clipEnd != null && dto.clipEnd <= dto.clipStart) {
      throw new ApiException(ErrorCode.INVALID_URL, "clipEnd must be greater than clipStart.");
    }

    try {
      const info = await this.extraction.getMediaInfo(dto.url);
      this.assertDuration(info.durationSeconds, principal);
    } catch (error) {
      if (error instanceof ApiException || error instanceof EngineError) throw error;
    }

    const record = await this.prisma.download.create({
      data: {
        url: dto.url,
        platform,
        kind: dto.kind,
        status: "QUEUED",
        quality: dto.quality ?? (dto.kind === "video" ? "highest" : "best"),
        format: dto.format ?? (dto.kind === "video" ? "mp4" : "mp3"),
        options: jobOptionsFromDto(dto, this.durationLimit(principal)) as Prisma.InputJsonValue,
        apiKeyId: principal.apiKey?.id ?? null,
        userId: principal.user?.id ?? null,
      },
    });

    this.events.emit(record.id, { type: "status", status: "QUEUED" });
    await this.queue.enqueue(record.id);
    this.metrics.recordJob("queued", platform);
    return toDownloadJob(record, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds);
  }

  async createBatch(dto: CreateBatchDto, principal: Principal = {}): Promise<DownloadJob[]> {
    const urls = [...new Set(dto.urls.map((url) => url.trim()).filter(Boolean))];
    const unsupported = urls.find((url) => !resolvePlatform(url, this.config.allowGenericUrls));
    if (unsupported) {
      throw new ApiException(
        ErrorCode.UNSUPPORTED_PLATFORM,
        `Unsupported URL in batch: ${unsupported}`,
      );
    }

    const headroom = MAX_PENDING_JOBS - (await this.queue.pendingCount());
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
      const platform = this.platformFor(url);
      const record = await this.prisma.download.create({
        data: {
          url,
          platform,
          kind: dto.kind,
          status: "QUEUED",
          quality: dto.quality ?? (dto.kind === "video" ? "highest" : "best"),
          format: dto.format ?? (dto.kind === "video" ? "mp4" : "mp3"),
          options: jobOptionsFromDto(
            {
              embedThumbnail: dto.kind === "audio" ? (dto.embedThumbnail ?? true) : undefined,
            },
            this.durationLimit(principal),
          ) as Prisma.InputJsonValue,
          apiKeyId: principal.apiKey?.id ?? null,
          userId: principal.user?.id ?? null,
        },
      });
      this.events.emit(record.id, { type: "status", status: "QUEUED" });
      await this.queue.enqueue(record.id);
      this.metrics.recordJob("queued", platform);
      jobs.push(toDownloadJob(record, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds));
    }

    this.logger.log(`Batch queued: ${jobs.length} job(s)`);
    return jobs;
  }

  async get(id: string): Promise<DownloadJob> {
    const record = await this.prisma.download.findUnique({ where: { id } });
    if (!record) {
      throw new ApiException(ErrorCode.JOB_NOT_FOUND, "Download not found", HttpStatus.NOT_FOUND);
    }
    return toDownloadJob(record, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds);
  }

  async getMany(ids: string[]): Promise<DownloadJob[]> {
    const wanted = [...new Set(ids)].slice(0, 100);
    if (wanted.length === 0) return [];
    const records = await this.prisma.download.findMany({ where: { id: { in: wanted } } });
    const byId = new Map(records.map((record) => [record.id, record]));
    return wanted.flatMap((id) => {
      const record = byId.get(id);
      return record ? [toDownloadJob(record, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds)] : [];
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

    await this.queue.cancel(id);
    const updated = await this.prisma.download.update({
      where: { id },
      data: { status: "CANCELLED", error: "Cancelled by user", errorCode: "CANCELLED" },
    });
    this.events.finish(id, { type: "error", message: "Download cancelled", code: "CANCELLED" });
    return toDownloadJob(updated, this.config.fileLinkSecret, this.config.signedUrlTtlSeconds);
  }

  events$(id: string) {
    return this.events.stream(id);
  }
}
