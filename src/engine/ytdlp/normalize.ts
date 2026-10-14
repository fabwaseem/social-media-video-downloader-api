import type {
  AudioQuality,
  CollectionEntry,
  MediaInfo,
  Platform,
  SubtitleTrack,
  VideoQuality,
} from "@snagbox/shared";
import { AUDIO_QUALITIES, VIDEO_FORMATS, AUDIO_FORMATS } from "@snagbox/shared";

/** Raw subset of yt-dlp's --dump-json output we rely on. */
export interface RawInfo {
  id: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  uploader_url?: string;
  channel_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  timestamp?: number;
  is_live?: boolean;
  formats?: Array<{ height?: number; vcodec?: string; acodec?: string }>;
  subtitles?: Record<string, Array<{ name?: string }>>;
  automatic_captions?: Record<string, Array<{ name?: string }>>;
}

export interface RawThumb {
  url?: string;
  width?: number;
  height?: number;
  preference?: number;
}

export interface RawEntry {
  id?: string;
  title?: string;
  url?: string;
  duration?: number;
  view_count?: number;
  thumbnails?: RawThumb[];
  live_status?: string;
  availability?: string;
  channel?: string;
  uploader?: string;
  ie_key?: string;
}

export interface RawCollection {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  channel_url?: string;
  uploader_url?: string;
  channel_follower_count?: number;
  playlist_count?: number;
  thumbnails?: RawThumb[];
  entries?: RawEntry[];
}

const KNOWN_HEIGHTS = ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

/** Largest thumbnail available; flat listings order them small to large. */
export function bestThumbnail(thumbs: RawThumb[] | undefined): string | null {
  if (!thumbs?.length) return null;
  let best: RawThumb | null = null;
  for (const thumb of thumbs) {
    if (!thumb?.url) continue;
    if (!best || (thumb.width ?? 0) >= (best.width ?? 0)) best = thumb;
  }
  return best?.url ?? null;
}

const UNAVAILABLE_TITLE = /^\[(private|deleted|unavailable)\s+video\]$/i;

export function normalizeEntry(entry: RawEntry): CollectionEntry {
  const id = entry.id ?? "";
  const title = entry.title?.trim() || "Untitled";
  const live = entry.live_status;
  const unavailable =
    UNAVAILABLE_TITLE.test(title) ||
    (entry.availability != null && entry.availability !== "public" && entry.availability !== "unlisted");

  return {
    id,
    title,
    url: entry.url ?? (id ? `https://www.youtube.com/watch?v=${id}` : ""),
    thumbnail: bestThumbnail(entry.thumbnails) ?? (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
    durationSeconds: typeof entry.duration === "number" ? entry.duration : null,
    viewCount: typeof entry.view_count === "number" ? entry.view_count : null,
    isLive: live === "is_live" || live === "is_upcoming",
    unavailable,
  };
}

export function normalizeInfo(raw: RawInfo, url: string, platform: Platform): MediaInfo {
  const heights = new Set<number>();
  for (const format of raw.formats ?? []) {
    if (format.height && format.vcodec && format.vcodec !== "none") heights.add(format.height);
  }
  const videoQualities = [...heights]
    .sort((a, b) => b - a)
    .map((height) => `${height}p`)
    .filter((quality): quality is VideoQuality => KNOWN_HEIGHTS.includes(quality));

  const subtitles: SubtitleTrack[] = [];
  for (const [lang, tracks] of Object.entries(raw.subtitles ?? {})) {
    subtitles.push({ lang, name: tracks[0]?.name ?? lang, auto: false });
  }

  return {
    id: raw.id,
    platform,
    url,
    title: raw.title || `${platform} media`,
    description: raw.description ?? "",
    thumbnail: raw.thumbnail ?? null,
    durationSeconds: raw.duration ?? null,
    uploader: raw.uploader ?? raw.channel ?? null,
    uploaderUrl: raw.uploader_url ?? raw.channel_url ?? null,
    viewCount: raw.view_count ?? null,
    likeCount: raw.like_count ?? null,
    commentCount: raw.comment_count ?? null,
    uploadedAt: raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : null,
    isLive: Boolean(raw.is_live),
    qualities: {
      video: videoQualities.length
        ? (["highest", ...videoQualities, "lowest"] as VideoQuality[])
        : (["highest", "1080p", "720p", "480p", "360p", "lowest"] as VideoQuality[]),
      audio: [...AUDIO_QUALITIES] as AudioQuality[],
    },
    formats: {
      video: [...VIDEO_FORMATS],
      audio: [...AUDIO_FORMATS],
    },
    subtitles,
  };
}

/**
 * Parses the first JSON document out of yt-dlp's stdout.
 * A link can resolve to several entries; the first document is the one named.
 */
export function parseFirstJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("The download engine returned no data for this URL.");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate.startsWith("{")) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Not a complete document on its own — keep looking.
      }
    }
    throw new Error("The download engine returned unreadable data for this URL.");
  }
}
