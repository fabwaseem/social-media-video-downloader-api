import { Injectable, Logger } from "@nestjs/common";
import type { MediaInfo, Platform, VideoQuality } from "@vidyoza/shared";
import { AUDIO_FORMATS, AUDIO_QUALITIES, VIDEO_FORMATS, detectPlatform } from "@vidyoza/shared";
import { basename, dirname, join } from "path";
import { AppConfigService } from "../config/app-config.service";
import { DirectDownloadService } from "./direct-download.service";
import { TikTokEmbedProvider } from "./providers/tiktok-embed.provider";
import type { MediaProvider, ProviderMedia } from "./providers/types";
import { CancelledError, RunDownloadInput, YtdlpService } from "./ytdlp.service";

const INFO_CACHE_MAX = 500;

/**
 * Resolves media through whichever engine can actually reach it.
 *
 * yt-dlp is always tried first: it supports every platform, every quality and
 * every container, and nothing else here comes close. But its extractors read
 * the same watch pages the platforms defend, so when TikTok answers with a WAF
 * challenge — or Facebook with a page shell its parser does not know — yt-dlp
 * has no path to the media and retrying only asks the same blocked question
 * again. The providers behind it reach the media a different way entirely, and
 * a request only fails once every engine has been tried.
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly providers: MediaProvider[];

  /**
   * TTL cache keyed by URL, storing promises so concurrent callers share one
   * extraction. Extraction costs seconds; the paste → download flow alone asks
   * for the same URL more than once.
   */
  private readonly infoCache = new Map<string, { promise: Promise<MediaInfo>; expires: number }>();

  constructor(
    private readonly ytdlp: YtdlpService,
    private readonly direct: DirectDownloadService,
    private readonly config: AppConfigService,
    tiktokEmbed: TikTokEmbedProvider,
  ) {
    this.providers = [tiktokEmbed];
  }

  async getMediaInfo(url: string): Promise<MediaInfo> {
    const ttl = this.config.mediaCacheTtlMs;
    if (ttl <= 0) return this.resolveInfo(url);

    const now = Date.now();
    const hit = this.infoCache.get(url);
    if (hit && hit.expires > now) return hit.promise;

    const promise = this.resolveInfo(url);
    // Never cache failures — transient platform errors must stay retryable.
    promise.catch(() => this.infoCache.delete(url));

    if (this.infoCache.size >= INFO_CACHE_MAX) {
      const oldest = this.infoCache.keys().next().value;
      if (oldest !== undefined) this.infoCache.delete(oldest);
    }
    this.infoCache.set(url, { promise, expires: now + ttl });
    return promise;
  }

  private async resolveInfo(url: string): Promise<MediaInfo> {
    const platform = detectPlatform(url);
    try {
      return await this.ytdlp.extractInfo(url);
    } catch (primaryError) {
      const media = await this.tryProviders(url, platform, primaryError);
      if (!media) throw primaryError;
      return this.toMediaInfo(media, url, platform ?? "tiktok");
    }
  }

  /** First provider that can both claim and resolve the URL, or null. */
  private async tryProviders(
    url: string,
    platform: Platform | null,
    primaryError: unknown,
  ): Promise<ProviderMedia | null> {
    for (const provider of this.providers) {
      if (!provider.supports(url, platform)) continue;
      try {
        const media = await provider.extract(url);
        this.logger.log(
          `yt-dlp could not reach ${url} (${errorText(primaryError)}); recovered via ${provider.name}`,
        );
        return media;
      } catch (providerError) {
        this.logger.warn(`Provider ${provider.name} also failed: ${errorText(providerError)}`);
      }
    }
    return null;
  }

  /**
   * Downloads through yt-dlp, falling back to a provider's direct URL.
   *
   * The fallback is a genuinely different route to the bytes, so it is worth
   * taking even though it gives up quality selection: one playable file beats a
   * perfectly-specified failure.
   */
  async runDownload(input: RunDownloadInput & { kind: "audio" | "video"; format: string }): Promise<void> {
    try {
      await this.ytdlp.runDownload(input);
      return;
    } catch (primaryError) {
      if (primaryError instanceof CancelledError || input.isCancelled?.()) throw primaryError;

      const platform = detectPlatform(input.url);
      const media = await this.tryProviders(input.url, platform, primaryError);
      const source = media?.videoUrls[0];
      if (!source) throw primaryError;

      this.logger.log(`Downloading ${input.url} directly via provider URL`);
      await this.downloadDirect(input, source, media.headers);
    }
  }

  private async downloadDirect(
    input: RunDownloadInput & { kind: "audio" | "video"; format: string },
    source: string,
    headers: Record<string, string>,
  ): Promise<void> {
    // yt-dlp's output template names the container it will choose; the direct
    // path knows it is fetching the platform's own mp4, so it resolves both the
    // temporary and the final name up front.
    const dir = dirname(input.outputPath);
    const base = basename(input.outputPath).replace(/\.%\(ext\)s$/, "");
    const fetched = join(dir, `${base}.src.mp4`);
    const target = join(dir, `${base}.${input.format}`);

    await this.direct.download({
      url: source,
      outputPath: fetched,
      headers,
      onProgress: input.onProgress,
      isCancelled: input.isCancelled,
    });

    if (input.kind === "video" && input.format === "mp4") {
      const { rename } = await import("fs/promises");
      await rename(fetched, target);
      return;
    }
    await this.direct.convert(fetched, target, input.kind);
  }

  /** Providers describe one rendition; MediaInfo has to describe the menu. */
  private toMediaInfo(media: ProviderMedia, url: string, platform: Platform): MediaInfo {
    return {
      id: media.id,
      platform,
      url,
      title: media.title,
      description: media.description,
      thumbnail: media.thumbnail,
      durationSeconds: media.durationSeconds,
      uploader: media.uploader,
      uploaderUrl: media.uploaderUrl,
      viewCount: media.viewCount,
      likeCount: media.likeCount,
      commentCount: media.commentCount,
      uploadedAt: media.uploadedAt,
      isLive: media.isLive,
      qualities: {
        // A provider serves the platform's single rendition, so offering a
        // quality ladder here would be a menu we cannot honour.
        video: ["highest"] as VideoQuality[],
        audio: [...AUDIO_QUALITIES],
      },
      formats: { video: [...VIDEO_FORMATS], audio: [...AUDIO_FORMATS] },
      subtitles: [],
    };
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);
}
