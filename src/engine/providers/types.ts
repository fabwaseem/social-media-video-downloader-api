import type { Platform } from "@vidyoza/shared";

/**
 * Media resolved by an extractor other than yt-dlp.
 *
 * Providers exist because yt-dlp's extractors go through the pages platforms
 * defend hardest. When TikTok serves its WAF challenge instead of the video
 * page, yt-dlp cannot read it no matter how many times we ask — but the embed
 * endpoint that powers third-party players is not defended the same way and
 * hands over both the metadata and a direct stream URL.
 */
export interface ProviderMedia {
  id: string;
  title: string;
  description: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  uploaderUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  uploadedAt: string | null;
  isLive: boolean;
  /**
   * Directly fetchable media URLs, best first. Empty means the provider
   * resolved metadata only — enough to answer /media/info, not to download.
   */
  videoUrls: string[];
  /** Headers required when fetching `videoUrls`. */
  headers: Record<string, string>;
}

/** A single alternate extraction strategy. */
export interface MediaProvider {
  /** Short identifier, surfaced in logs. */
  readonly name: string;
  /** Whether this provider can attempt the URL at all. */
  supports(url: string, platform: Platform | null): boolean;
  /** Resolves the media, or throws if this provider cannot. */
  extract(url: string): Promise<ProviderMedia>;
}
