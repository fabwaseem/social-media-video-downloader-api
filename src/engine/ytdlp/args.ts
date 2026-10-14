import type {
  AudioFormat,
  AudioQuality,
  CreateDownloadRequest,
  VideoFormat,
  VideoQuality,
} from "@downloader/shared";
import { AUDIO_FORMATS, VIDEO_FORMATS } from "@downloader/shared";
import { PROGRESS_TEMPLATE } from "../progress";
import type { Attempt } from "../resilience";

/**
 * YouTube player clients, in the order yt-dlp should try them.
 * `default` leads so nothing changes for videos that already work.
 */
export const YOUTUBE_CLIENTS = "default,web_safari,mweb,tv_embedded,android_vr,android";

const AUDIO_QUALITY_ARG: Record<AudioQuality, string> = {
  best: "0",
  high: "2",
  medium: "5",
  low: "7",
};

/** Values the argument builder reads. Cookies are passed only when the file exists. */
export interface YtdlpArgContext {
  verbose: boolean;
  jsRuntime: string;
  pluginDir: string;
  cookiesPath: string;
  potBaseUrl: string;
  proxy: string;
  forceIpv4: boolean;
  ffmpegPath: string;
  extraArgs: string[];
  concurrentFragments: number;
}

export function buildBaseArgs(ctx: YtdlpArgContext, playlist = false): string[] {
  const args = [
    playlist ? "--yes-playlist" : "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "--ignore-config",
    "--socket-timeout",
    "15",
    "--retries",
    "3",
    "--fragment-retries",
    "5",
    "--extractor-retries",
    "3",
    "--retry-sleep",
    "linear=1::2",
  ];
  if (ctx.verbose) args.push("-v");
  if (ctx.jsRuntime) args.push("--js-runtimes", ctx.jsRuntime);
  if (ctx.pluginDir) args.push("--plugin-dirs", "default", "--plugin-dirs", ctx.pluginDir);
  args.push("--extractor-args", `youtube:player_client=${YOUTUBE_CLIENTS}`);
  if (ctx.potBaseUrl) {
    args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${ctx.potBaseUrl}`);
  }
  if (ctx.cookiesPath) args.push("--cookies", ctx.cookiesPath);
  if (ctx.proxy) args.push("--proxy", ctx.proxy);
  if (ctx.forceIpv4) args.push("--force-ipv4");
  if (ctx.ffmpegPath && ctx.ffmpegPath !== "ffmpeg") args.push("--ffmpeg-location", ctx.ffmpegPath);
  args.push(...ctx.extraArgs);
  return args;
}

/** Drops attempt flags the operator already pinned via YTDLP_EXTRA_ARGS. */
export function filterAttemptArgs(extraArgs: string[], attempt: Attempt): string[] {
  const pinned = new Set(extraArgs.filter((arg) => arg.startsWith("--")));
  const args: string[] = [];
  for (let i = 0; i < attempt.args.length - 1; i += 2) {
    if (!pinned.has(attempt.args[i])) args.push(attempt.args[i], attempt.args[i + 1]);
  }
  return args;
}

export function videoFormatSelector(quality: VideoQuality): string {
  if (quality === "highest") return "bestvideo*+bestaudio/best";
  if (quality === "lowest") return "worstvideo*+worstaudio/worst";
  const height = parseInt(quality, 10);
  return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}

export function formatClipTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function buildDownloadArgs(
  ctx: YtdlpArgContext,
  attempt: Attempt,
  request: CreateDownloadRequest,
  outputPath: string,
): string[] {
  const args = [
    ...buildBaseArgs(ctx),
    ...filterAttemptArgs(ctx.extraArgs, attempt),
    "--newline",
    "--progress-template",
    PROGRESS_TEMPLATE,
    "--force-overwrites",
    "--concurrent-fragments",
    String(ctx.concurrentFragments),
    "-o",
    outputPath,
  ];

  if (request.kind === "audio") {
    const format = (request.format as AudioFormat) ?? "mp3";
    const quality = (request.quality as AudioQuality) ?? "best";
    args.push(
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      AUDIO_FORMATS.includes(format) ? format : "mp3",
      "--audio-quality",
      AUDIO_QUALITY_ARG[quality] ?? "0",
    );
    if (request.embedThumbnail) args.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
    if (request.embedMetadata || request.embedThumbnail) args.push("--embed-metadata");
    if (request.embedChapters) args.push("--embed-chapters");
  } else {
    const format = (request.format as VideoFormat) ?? "mp4";
    const quality = (request.quality as VideoQuality) ?? "highest";
    const container = VIDEO_FORMATS.includes(format) ? format : "mp4";
    args.push("-f", videoFormatSelector(quality), "--merge-output-format", container === "gif" ? "mp4" : container);
    if (container === "gif") args.push("--recode-video", "gif");
    if (request.videoCodec === "h264") {
      args.push("--recode-video", "mp4", "--postprocessor-args", "ffmpeg:-c:v libx264 -c:a aac");
    }
    if (request.embedSubtitles || request.writeSubtitles) {
      args.push("--write-subs", "--sub-langs", request.subtitleLang || "en.*,en");
      if (request.embedSubtitles) args.push("--embed-subs");
    }
    if (request.writeThumbnail || request.embedThumbnail) args.push("--write-thumbnail");
    if (request.embedMetadata) args.push("--embed-metadata");
    if (request.embedChapters) args.push("--embed-chapters");
  }

  if (request.clipStart != null || request.clipEnd != null) {
    const start = formatClipTime(request.clipStart ?? 0);
    const end = request.clipEnd != null ? formatClipTime(request.clipEnd) : "inf";
    args.push("--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts");
  }

  args.push("--", attempt.url);
  return args;
}
