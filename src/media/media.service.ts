import { Injectable } from "@nestjs/common";
import type { ChannelTab, CollectionInfo } from "@vidyoza/shared";
import {
  CHANNEL_TABS,
  PLATFORM_META,
  PLATFORMS,
  detectChannelTab,
  detectPlatform,
  detectUrlKind,
  isValidHttpUrl,
  normalizeCollectionUrl,
} from "@vidyoza/shared";
import { ApiException, ErrorCode } from "../common/errors";
import { ExtractionService } from "../engine/extraction.service";
import { YtdlpService } from "../engine/ytdlp.service";

/** One extraction already covers this many rows in ~2s; more just adds latency. */
const MAX_COLLECTION_PAGE = 100;

@Injectable()
export class MediaService {
  constructor(
    private readonly extraction: ExtractionService,
    private readonly ytdlp: YtdlpService,
  ) {}

  private assertSupported(url: string): void {
    if (!url || !isValidHttpUrl(url)) {
      throw new ApiException(ErrorCode.INVALID_URL, "Please provide a valid http(s) URL.");
    }
    if (!detectPlatform(url)) {
      throw new ApiException(
        ErrorCode.UNSUPPORTED_PLATFORM,
        "This URL does not belong to a supported platform (YouTube, Instagram, TikTok, X/Twitter, Facebook).",
      );
    }
  }

  async getInfo(url: string) {
    this.assertSupported(url);
    try {
      return await this.extraction.getMediaInfo(url.trim());
    } catch (error) {
      throw new ApiException(
        ErrorCode.EXTRACTION_FAILED,
        error instanceof Error ? error.message : "Failed to fetch media info.",
      );
    }
  }

  /**
   * Lists a page of a playlist or channel.
   *
   * The tab is part of the identity of a channel listing, not a filter applied
   * afterwards: yt-dlp lists `/@handle/videos` and `/@handle/shorts` as two
   * separate playlists, so switching tabs is a fresh listing.
   */
  async getCollection(params: {
    url: string;
    tab?: string;
    offset?: number;
    limit?: number;
  }): Promise<CollectionInfo> {
    const url = (params.url ?? "").trim();
    this.assertSupported(url);

    const kind = detectUrlKind(url);
    if (kind === "video") {
      throw new ApiException(
        ErrorCode.INVALID_URL,
        "That link points at a single video. Use /v2/media/info for videos.",
      );
    }

    const requestedTab = params.tab?.trim().toLowerCase();
    if (requestedTab && !CHANNEL_TABS.includes(requestedTab as ChannelTab)) {
      throw new ApiException(
        ErrorCode.INVALID_URL,
        `Unknown tab "${requestedTab}". Expected one of: ${CHANNEL_TABS.join(", ")}.`,
      );
    }

    const tab: ChannelTab | null =
      kind === "channel"
        ? ((requestedTab as ChannelTab) ?? detectChannelTab(url) ?? "videos")
        : null;

    const offset = Math.max(1, Math.trunc(params.offset ?? 1));
    const limit = Math.min(MAX_COLLECTION_PAGE, Math.max(1, Math.trunc(params.limit ?? 50)));

    try {
      return await this.ytdlp.getCollectionInfo({
        url: normalizeCollectionUrl(url, tab ?? "videos"),
        sourceUrl: url,
        kind,
        tab,
        offset,
        limit,
      });
    } catch (error) {
      throw new ApiException(
        ErrorCode.EXTRACTION_FAILED,
        error instanceof Error ? error.message : "Failed to list that link.",
      );
    }
  }

  async getPlaylist(url: string) {
    this.assertSupported(url);
    try {
      return await this.ytdlp.getPlaylistInfo(url);
    } catch (error) {
      throw new ApiException(
        ErrorCode.EXTRACTION_FAILED,
        error instanceof Error ? error.message : "Failed to fetch playlist info.",
      );
    }
  }

  getPlatforms() {
    return PLATFORMS.map((id) => PLATFORM_META[id]);
  }
}
