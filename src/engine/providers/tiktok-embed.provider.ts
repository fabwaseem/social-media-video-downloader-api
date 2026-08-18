import { Injectable, Logger } from "@nestjs/common";
import type { Platform } from "@vidyoza/shared";
import { DESKTOP_UA } from "../resilience";
import type { MediaProvider, ProviderMedia } from "./types";

/**
 * Resolves TikTok videos through the oEmbed player endpoint.
 *
 * TikTok fronts its watch pages with a WAF that intermittently answers with a
 * "Please wait…" challenge stub instead of the video. yt-dlp's extractor reads
 * the watch page, so when the challenge fires it reports "Unable to extract
 * universal data for rehydration" and no retry helps until the WAF relents.
 *
 * `/embed/v2/<id>` is the endpoint that powers TikTok embeds on other sites. It
 * is not behind that challenge — it has to work for third-party players — and
 * its page state carries both the metadata and a directly fetchable CDN URL.
 */
@Injectable()
export class TikTokEmbedProvider implements MediaProvider {
  readonly name = "tiktok-embed";
  private readonly logger = new Logger(TikTokEmbedProvider.name);

  supports(url: string, platform: Platform | null): boolean {
    return platform === "tiktok" && Boolean(this.videoId(url) || this.isShortLink(url));
  }

  async extract(url: string): Promise<ProviderMedia> {
    const id = this.videoId(url) ?? (await this.resolveShortLink(url));
    if (!id) throw new Error("Could not determine the TikTok video id from that link.");

    const html = await this.fetchText(`https://www.tiktok.com/embed/v2/${id}`);
    const data = this.parseEmbedState(html, id);

    const info = data.itemInfos ?? {};
    const author = data.authorInfos ?? {};
    const videoUrls = (info.video?.urls ?? []).filter(
      (u): u is string => typeof u === "string" && u.startsWith("http"),
    );
    const created = Number(info.createTime);

    return {
      id: info.id ?? id,
      title: (info.text ?? "").trim() || "TikTok video",
      description: info.text ?? "",
      thumbnail: info.coversOrigin?.[0] ?? info.covers?.[0] ?? null,
      // The embed payload carries no duration; the caller treats null as
      // "unknown", which only means duration limits cannot be enforced here.
      durationSeconds: null,
      uploader: author.nickName || author.uniqueId || null,
      uploaderUrl: author.uniqueId ? `https://www.tiktok.com/@${author.uniqueId}` : null,
      viewCount: numberOrNull(info.playCount),
      likeCount: numberOrNull(info.diggCount),
      commentCount: numberOrNull(info.commentCount),
      uploadedAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
      isLive: false,
      videoUrls,
      headers: { "User-Agent": DESKTOP_UA, Referer: "https://www.tiktok.com/" },
    };
  }

  /** The numeric id from a canonical `/@user/video/<id>` (or `/photo/<id>`) link. */
  private videoId(url: string): string | null {
    return /\/(?:video|photo)\/(\d{6,})/.exec(url)?.[1] ?? null;
  }

  private isShortLink(url: string): boolean {
    return /(?:vm|vt)\.tiktok\.com\/|tiktok\.com\/t\//i.test(url);
  }

  /** Short links only reveal the id through their redirect. */
  private async resolveShortLink(url: string): Promise<string | null> {
    if (!this.isShortLink(url)) return null;
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": DESKTOP_UA },
      signal: AbortSignal.timeout(20_000),
    });
    return this.videoId(response.url);
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Embed endpoint returned HTTP ${response.status}`);
    return response.text();
  }

  /**
   * Pulls the video out of the embed page's hydration state.
   *
   * The state is keyed by request path, and the exact key has changed between
   * TikTok releases, so the entry is found by shape (the one carrying
   * `videoData`) rather than by name.
   */
  private parseEmbedState(html: string, id: string): EmbedVideoData {
    if (html.includes("_wafchallengeid")) {
      throw new Error("TikTok served a bot challenge to the embed endpoint too.");
    }
    const match = /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error("Embed page did not contain the expected player state.");

    let state: unknown;
    try {
      state = JSON.parse(match[1]);
    } catch {
      throw new Error("Embed player state was not valid JSON.");
    }

    const bucket = (state as EmbedState)?.source?.data ?? {};
    const entry =
      bucket[`/embed/v2/${id}`] ??
      Object.values(bucket).find((v) => v && typeof v === "object" && "videoData" in v);
    const videoData = entry?.videoData;
    if (!videoData) throw new Error("Embed player state carried no video data.");
    return videoData;
  }
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

interface EmbedVideoData {
  itemInfos?: {
    id?: string;
    text?: string;
    createTime?: string;
    covers?: string[];
    coversOrigin?: string[];
    playCount?: number;
    diggCount?: number;
    commentCount?: number;
    video?: { urls?: string[] };
  };
  authorInfos?: { uniqueId?: string; nickName?: string };
}

interface EmbedState {
  source?: { data?: Record<string, { videoData?: EmbedVideoData } | undefined> };
}
