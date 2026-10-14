import type { CreateDownloadRequest } from "@vidyoza/shared";

/** Options that have to survive a process restart, stored on the download row. */
export interface StoredJobOptions {
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  embedChapters?: boolean;
  embedSubtitles?: boolean;
  subtitleLang?: string;
  clipStart?: number;
  clipEnd?: number;
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
    subtitleLang: typeof raw.subtitleLang === "string" ? raw.subtitleLang : undefined,
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
    | "subtitleLang"
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
    subtitleLang: dto.subtitleLang,
    clipStart: dto.clipStart,
    clipEnd: dto.clipEnd,
    maxDurationSeconds,
  };
}
