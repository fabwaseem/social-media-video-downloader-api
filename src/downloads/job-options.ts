import type { CreateDownloadRequest } from "@downloader/shared";

/** Options that have to survive a process restart, stored on the download row. */
export interface StoredJobOptions {
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  embedChapters?: boolean;
  embedSubtitles?: boolean;
  writeSubtitles?: boolean;
  writeThumbnail?: boolean;
  videoCodec?: "h264";
  subtitleLang?: string;
  clipStart?: number;
  clipEnd?: number;
  callbackUrl?: string;
  maxDurationSeconds?: number;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readJobOptions(value: unknown): StoredJobOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    embedThumbnail: bool(raw.embedThumbnail),
    embedMetadata: bool(raw.embedMetadata),
    embedChapters: bool(raw.embedChapters),
    embedSubtitles: bool(raw.embedSubtitles),
    writeSubtitles: bool(raw.writeSubtitles),
    writeThumbnail: bool(raw.writeThumbnail),
    videoCodec: raw.videoCodec === "h264" ? "h264" : undefined,
    subtitleLang: typeof raw.subtitleLang === "string" ? raw.subtitleLang : undefined,
    callbackUrl: typeof raw.callbackUrl === "string" ? raw.callbackUrl : undefined,
    clipStart: num(raw.clipStart),
    clipEnd: num(raw.clipEnd),
    maxDurationSeconds: num(raw.maxDurationSeconds),
  };
}

export function jobOptionsFromDto(
  dto: Pick<
    CreateDownloadRequest,
    | "embedThumbnail"
    | "embedMetadata"
    | "embedChapters"
    | "embedSubtitles"
    | "writeSubtitles"
    | "writeThumbnail"
    | "videoCodec"
    | "subtitleLang"
    | "callbackUrl"
    | "clipStart"
    | "clipEnd"
  >,
  maxDurationSeconds: number,
): StoredJobOptions {
  return {
    embedThumbnail: dto.embedThumbnail,
    embedMetadata: dto.embedMetadata,
    embedChapters: dto.embedChapters,
    embedSubtitles: dto.embedSubtitles,
    writeSubtitles: dto.writeSubtitles,
    writeThumbnail: dto.writeThumbnail,
    videoCodec: dto.videoCodec,
    subtitleLang: dto.subtitleLang,
    callbackUrl: dto.callbackUrl,
    clipStart: dto.clipStart,
    clipEnd: dto.clipEnd,
    maxDurationSeconds,
  };
}
