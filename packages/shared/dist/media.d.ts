import type { ChannelTab, Platform } from "./platforms";
/** Media kinds a job can produce. */
export type MediaKind = "video" | "audio";
export declare const VIDEO_QUALITIES: readonly ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p", "highest", "lowest"];
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];
export declare const AUDIO_QUALITIES: readonly ["best", "high", "medium", "low"];
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];
export declare const VIDEO_FORMATS: readonly ["mp4", "mkv", "webm"];
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export declare const AUDIO_FORMATS: readonly ["mp3", "m4a", "opus", "wav", "flac"];
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
export declare const VIDEO_QUALITY_LABELS: Record<VideoQuality, string>;
export declare const AUDIO_QUALITY_LABELS: Record<AudioQuality, string>;
/** Normalized media info returned by GET /v2/media/info. */
export interface MediaInfo {
    id: string;
    platform: Platform;
    url: string;
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
    qualities: {
        video: VideoQuality[];
        audio: AudioQuality[];
    };
    formats: {
        video: VideoFormat[];
        audio: AudioFormat[];
    };
    subtitles: SubtitleTrack[];
}
export interface SubtitleTrack {
    lang: string;
    name: string;
    auto: boolean;
}
export interface PlaylistEntry {
    id: string;
    title: string;
    url: string;
    thumbnail: string | null;
    durationSeconds: number | null;
    uploader: string | null;
}
export interface PlaylistInfo {
    id: string;
    title: string;
    url: string;
    entryCount: number;
    entries: PlaylistEntry[];
}
/** One listed video inside a playlist or channel. */
export interface CollectionEntry {
    id: string;
    title: string;
    url: string;
    thumbnail: string | null;
    durationSeconds: number | null;
    viewCount: number | null;
    isLive: boolean;
    /** Private, deleted or members-only — listed, but not downloadable. */
    unavailable: boolean;
}
/**
 * A page of a playlist or channel.
 *
 * Entries come from a flat listing: one extraction for the whole page rather
 * than one per video, which is the difference between two seconds and two
 * minutes on a 100-video channel. Per-video details are resolved lazily, when
 * a download actually starts.
 */
export interface CollectionInfo {
    kind: "playlist" | "channel";
    id: string;
    title: string;
    /** The normalized URL this page was listed from (channels include the tab). */
    url: string;
    /** The URL the visitor supplied, kept for links back out. */
    sourceUrl: string;
    uploader: string | null;
    uploaderUrl: string | null;
    thumbnail: string | null;
    followerCount: number | null;
    /** Total entries when the platform reports it, else null. */
    totalCount: number | null;
    tab: ChannelTab | null;
    entries: CollectionEntry[];
    /** 1-based index of the first entry in this page. */
    offset: number;
    limit: number;
    hasMore: boolean;
}
/** Body of POST /v2/downloads/batch. */
export interface CreateBatchRequest {
    urls: string[];
    kind: MediaKind;
    quality?: VideoQuality | AudioQuality;
    format?: VideoFormat | AudioFormat;
    embedThumbnail?: boolean;
}
