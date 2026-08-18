import type {
  AudioFormat,
  AudioQuality,
  MediaKind,
  VideoFormat,
  VideoQuality,
} from "./media";
import type { Platform } from "./platforms";

export const JOB_STATUSES = [
  "QUEUED",
  "FETCHING_INFO",
  "DOWNLOADING",
  "CONVERTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Body of POST /v2/downloads. */
export interface CreateDownloadRequest {
  url: string;
  kind: MediaKind;
  /** Video quality (kind=video) or audio quality (kind=audio). */
  quality?: VideoQuality | AudioQuality;
  /** Output container/codec. */
  format?: VideoFormat | AudioFormat;
  /** Embed thumbnail into audio/video files. */
  embedThumbnail?: boolean;
  /** Embed rich metadata and tags (ID3/MP4). */
  embedMetadata?: boolean;
  /** Embed chapter markers. */
  embedChapters?: boolean;
  /** Embed subtitles when available (kind=video). */
  embedSubtitles?: boolean;
  /** Subtitle language code to embed, e.g. "en". */
  subtitleLang?: string;
  /** Download a clip: start time in seconds. */
  clipStart?: number;
  /** Download a clip: end time in seconds. */
  clipEnd?: number;
}

export interface DownloadJob {
  id: string;
  platform: Platform;
  url: string;
  kind: MediaKind;
  status: JobStatus;
  title: string | null;
  thumbnail: string | null;
  quality: string | null;
  format: string | null;
  filename: string | null;
  /** Relative URL to fetch the finished file from the API. */
  fileUrl: string | null;
  fileSizeBytes: number | null;
  error: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

/** SSE events emitted on GET /v2/downloads/:id/events */
export type JobEvent =
  | { type: "status"; status: JobStatus }
  | {
      type: "progress";
      status: JobStatus;
      /** 0..100 */
      percentage: number;
      downloadedBytes: number;
      totalBytes: number;
      /** bytes/sec */
      speed: number;
      /** seconds remaining */
      eta: number;
    }
  | { type: "complete"; job: DownloadJob }
  | { type: "error"; message: string; code?: string };

/** Standard API error envelope produced by the global exception filter. */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  requestId?: string;
  timestamp: string;
  path: string;
  details?: unknown;
}
