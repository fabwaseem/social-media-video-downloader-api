import { Injectable, Logger } from "@nestjs/common";
import type {
  AudioFormat,
  AudioQuality,
  ChannelTab,
  CollectionEntry,
  CollectionInfo,
  CreateDownloadRequest,
  MediaInfo,
  PlaylistInfo,
  Platform,
  SubtitleTrack,
  VideoFormat,
  VideoQuality,
} from "@vidyoza/shared";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  VIDEO_FORMATS,
  detectPlatform,
} from "@vidyoza/shared";
import { ChildProcess, execFile, spawn } from "child_process";
import * as fsSync from "fs";
import { promisify } from "util";
import { AppConfigService } from "../config/app-config.service";
import { DETACH_CHILDREN } from "../common/utils/kill-tree";
import { BinariesService } from "./binaries.service";
import {
  EngineProgress,
  PROGRESS_TEMPLATE,
  ProgressAggregator,
  parseProgressLine,
} from "./progress";
import {
  Attempt,
  briefError,
  buildAttempts,
  isKnownTransient,
  isRetryable,
  rawErrorText,
  retryDelayMs,
  sleep,
} from "./resilience";

const execFileAsync = promisify(execFile);

export interface SpawnedDownload {
  child: ChildProcess;
  /** Resolves on success, rejects with a friendly error. */
  done: Promise<void>;
}

/** Everything the caller needs to drive one retrying download. */
export interface RunDownloadInput {
  url: string;
  request: CreateDownloadRequest;
  outputPath: string;
  onProgress: (p: EngineProgress) => void;
  /** Receives the live child of every attempt, so cancellation can reach it. */
  onProcess?: (child: ChildProcess) => void;
  /** Consulted between attempts — a cancelled job must not be retried. */
  isCancelled?: () => boolean;
  /** Fired before each retry, for status reporting. */
  onRetry?: (info: { attempt: number; total: number; reason: string }) => void;
}

/** Raw subset of yt-dlp's --dump-json output we rely on. */
interface RawInfo {
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

interface RawThumb {
  url?: string;
  width?: number;
  height?: number;
  preference?: number;
}

/** Flat-playlist entry — a listing row, not a full extraction. */
interface RawEntry {
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

interface RawCollection {
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

/** Largest thumbnail available; flat listings order them small to large. */
function bestThumbnail(thumbs: RawThumb[] | undefined): string | null {
  if (!thumbs?.length) return null;
  let best: RawThumb | null = null;
  for (const t of thumbs) {
    if (!t?.url) continue;
    if (!best || (t.width ?? 0) >= (best.width ?? 0)) best = t;
  }
  return best?.url ?? null;
}

/**
 * Titles like "[Private video]" are how YouTube reports entries it will not
 * serve. They stay in the list — a gap in a numbered playlist is more
 * confusing than a row that says why it cannot be downloaded.
 */
const UNAVAILABLE_TITLE = /^\[(private|deleted|unavailable)\s+video\]$/i;

function normalizeEntry(entry: RawEntry, parent: RawCollection): CollectionEntry {
  const id = entry.id ?? "";
  const title = entry.title?.trim() || "Untitled";
  const live = entry.live_status;
  const unavailable =
    UNAVAILABLE_TITLE.test(title) ||
    (entry.availability != null &&
      entry.availability !== "public" &&
      entry.availability !== "unlisted");

  return {
    id,
    title,
    url: entry.url ?? (id ? `https://www.youtube.com/watch?v=${id}` : ""),
    thumbnail:
      bestThumbnail(entry.thumbnails) ??
      (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
    durationSeconds: typeof entry.duration === "number" ? entry.duration : null,
    viewCount: typeof entry.view_count === "number" ? entry.view_count : null,
    isLive: live === "is_live" || live === "is_upcoming",
    unavailable,
  };
}

/**
 * YouTube player clients, in the order yt-dlp should try them.
 *
 * Two different escapes from the sign-in wall, and the order matters because
 * they do not overlap. The web clients are the only ones that ask for a proof-
 * of-origin token, so they must stay in the list for the PO token provider to
 * be used at all — with a list of purely non-web clients the provider is never
 * consulted, which is measurably what happened before. The embedded-TV and
 * Android clients need no token and cover the case where no provider is
 * configured.
 *
 * `default` leads so nothing changes for videos that already work.
 */
const YOUTUBE_CLIENTS = "default,web_safari,mweb,tv_embedded,android_vr,android";

const AUDIO_QUALITY_ARG: Record<AudioQuality, string> = {
  best: "0",
  high: "2",
  medium: "5",
  low: "7",
};

@Injectable()
export class YtdlpService {
  private readonly logger = new Logger(YtdlpService.name);

  constructor(
    private readonly binaries: BinariesService,
    private readonly config: AppConfigService,
  ) {}

  private baseArgs({ playlist = false }: { playlist?: boolean } = {}): string[] {
    const args = [
      playlist ? "--yes-playlist" : "--no-playlist",
      "--no-warnings",
      "--restrict-filenames",
      // A yt-dlp.conf left on the host would silently change behaviour we have
      // tuned here, and the symptom (works on my machine) is miserable to
      // diagnose. Every option this service relies on is passed explicitly.
      "--ignore-config",
      // Fail fast on dead sockets and retry transient network errors instead
      // of hanging — datacenter networks flake more than home connections.
      "--socket-timeout",
      "15",
      "--retries",
      "3",
      "--fragment-retries",
      "5",
      // yt-dlp's own retry budget for the errors it recognizes as retryable.
      // It does not cover extractor parse failures — those are handled by the
      // attempt ladder in `run`/`runDownload`.
      "--extractor-retries",
      "3",
      "--retry-sleep",
      "linear=1::2",
    ];
    if (this.config.ytdlpVerbose) args.push("-v");
    // Solves YouTube's `n` challenge. Without it YouTube returns storyboards
    // only and reports a bot check — see BinariesService.resolveJsRuntime.
    if (this.binaries.jsRuntime) {
      args.push("--js-runtimes", this.binaries.jsRuntime);
    }
    // "default" keeps yt-dlp's own search paths alongside ours.
    if (this.binaries.pluginDir) {
      args.push("--plugin-dirs", "default", "--plugin-dirs", this.binaries.pluginDir);
    }
    // YouTube demands a proof-of-origin token for a growing share of videos
    // and answers without one by claiming the caller is a bot. The embedded-TV
    // and Android clients escape that check, so listing them after the default
    // lets yt-dlp fall through to a working client inside a single invocation.
    //
    // That is enough from a residential connection but not from a server IP
    // range, which YouTube holds to the check on every client — measured, not
    // assumed: the same video these clients serve here is refused in
    // production. The PO token provider below is what covers that gap.
    // Namespaced to youtube, so it is inert for every other extractor.
    args.push("--extractor-args", `youtube:player_client=${YOUTUBE_CLIENTS}`);
    // Points the bundled bgutil plugin at its provider. Without a provider the
    // plugin loads but has nothing to ask, so the flag is only worth sending
    // when one is actually configured.
    if (this.config.ytdlpPotBaseUrl) {
      args.push(
        "--extractor-args",
        `youtubepot-bgutilhttp:base_url=${this.config.ytdlpPotBaseUrl}`,
      );
    }
    const cookies = this.binaries.cookiesPath;
    if (cookies && fsSync.existsSync(cookies)) {
      args.push("--cookies", cookies);
    }
    if (this.config.ytdlpProxy) {
      args.push("--proxy", this.config.ytdlpProxy);
    }
    if (this.config.ytdlpForceIpv4) {
      args.push("--force-ipv4");
    }
    if (this.binaries.ffmpegPath && this.binaries.ffmpegPath !== "ffmpeg") {
      args.push("--ffmpeg-location", this.binaries.ffmpegPath);
    }
    // Operator-tuned extras last so they can override our defaults
    // (e.g. --extractor-args "youtube:player_client=web_safari").
    args.push(...this.config.ytdlpExtraArgs);
    return args;
  }

  /**
   * Attempt-only args, minus anything the operator has already pinned.
   *
   * `YTDLP_EXTRA_ARGS` is documented as the last word on configuration, so a
   * deployment that sets its own `--user-agent` keeps it even on a retry rung
   * that would otherwise supply one.
   *
   * Every rung in the ladder is built from `--flag value` pairs, which is what
   * lets a dropped flag take its value with it.
   */
  private attemptArgs(attempt: Attempt): string[] {
    const pinned = new Set(this.config.ytdlpExtraArgs.filter((a) => a.startsWith("--")));
    const args: string[] = [];
    for (let i = 0; i < attempt.args.length - 1; i += 2) {
      if (!pinned.has(attempt.args[i])) args.push(attempt.args[i], attempt.args[i + 1]);
    }
    return args;
  }

  /**
   * Runs one read-only yt-dlp operation, climbing the attempt ladder until it
   * succeeds or hits a failure no retry can fix.
   *
   * `opArgs` carries only the operation itself (`--dump-json`, `--flat-playlist`
   * …); the base args, the per-attempt variations and the URL are composed here,
   * because the URL is part of what an attempt varies.
   */
  private async run(
    opArgs: string[],
    opts: { url: string; playlist?: boolean; timeoutMs?: number },
  ): Promise<string> {
    await this.binaries.ensureReady();

    const attempts = buildAttempts(
      opts.url,
      detectPlatform(opts.url),
      this.config.ytdlpMaxAttempts,
    );
    const timeout = opts.timeoutMs ?? 60_000;
    let lastError = "";

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        const inv = this.binaries.ytdlp;
        const args = [
          ...this.baseArgs({ playlist: opts.playlist }),
          ...this.attemptArgs(attempt),
          ...opArgs,
          attempt.url,
        ];
        const { stdout } = await execFileAsync(inv.command, [...inv.argsPrefix, ...args], {
          timeout,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        });
        if (i > 0) {
          this.logger.log(
            `Recovered on attempt ${i + 1}/${attempts.length} via "${attempt.label}": ${opts.url}`,
          );
        }
        return stdout;
      } catch (error) {
        lastError = rawErrorText(error);
        if (this.config.ytdlpVerbose) {
          this.logger.warn(`yt-dlp stderr (attempt ${i + 1}):
${lastError.slice(-6000)}`);
        }
        if (i === attempts.length - 1 || !isRetryable(lastError)) break;
        this.logger.warn(
          `Attempt ${i + 1}/${attempts.length} ("${attempt.label}") failed${
            isKnownTransient(lastError) ? " transiently" : ""
          }, retrying: ${briefError(lastError)}`,
        );
        await sleep(retryDelayMs(i, this.config.ytdlpRetryBaseMs));
      }
    }

    throw new Error(friendlyYtdlpError(lastError));
  }

  /** Uncached single-engine extraction. Caching lives in ExtractionService. */
  async extractInfo(url: string): Promise<MediaInfo> {
    const platform = detectPlatform(url);
    const stdout = await this.run(["--dump-json", "--no-download"], { url });
    return this.normalizeInfo(parseFirstJson<RawInfo>(stdout), url, platform ?? "youtube");
  }

  /**
   * Lists one page of a playlist or channel.
   *
   * `--flat-playlist` is the whole trick: yt-dlp returns the listing straight
   * from the tab's paging API, so 100 entries cost one process and ~2s instead
   * of 100 extractions. It still carries title, duration, view count and
   * thumbnails — everything the listing UI shows. Formats are resolved later,
   * per video, only for the ones actually downloaded.
   */
  async getCollectionInfo(input: {
    /** Already normalized: channels must name a tab. */
    url: string;
    sourceUrl: string;
    kind: "playlist" | "channel";
    tab: ChannelTab | null;
    offset: number;
    limit: number;
  }): Promise<CollectionInfo> {
    const { url, sourceUrl, kind, tab, offset, limit } = input;
    // Ask for one extra entry: if it comes back there is another page, which
    // saves a second request just to discover the list is exhausted.
    const end = offset + limit;
    const stdout = await this.run(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--no-download",
        "--playlist-items",
        `${offset}:${end}`,
      ],
      { url, playlist: true, timeoutMs: 180_000 },
    );

    const raw = parseFirstJson<RawCollection>(stdout);
    const all = raw.entries ?? [];
    const hasMore = all.length > limit;
    const page = hasMore ? all.slice(0, limit) : all;

    return {
      kind,
      id: raw.id ?? "",
      title: raw.title ?? (kind === "channel" ? "Channel" : "Playlist"),
      url,
      sourceUrl,
      uploader: raw.channel ?? raw.uploader ?? null,
      uploaderUrl: raw.channel_url ?? raw.uploader_url ?? null,
      thumbnail: bestThumbnail(raw.thumbnails) ?? null,
      followerCount: raw.channel_follower_count ?? null,
      totalCount: raw.playlist_count ?? null,
      tab,
      offset,
      limit,
      hasMore,
      entries: page.map((e) => normalizeEntry(e, raw)),
    };
  }

  async getPlaylistInfo(url: string, limit = 100): Promise<PlaylistInfo> {
    // Playlists need the same cookies/proxy/JS-runtime hardening as single
    // videos — the bot check applies to playlist pages too.
    const stdout = await this.run(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--no-download",
        "--playlist-items",
        `1:${limit}`,
      ],
      { url, playlist: true, timeoutMs: 120_000 },
    );
    const raw = parseFirstJson<{
      id?: string;
      title?: string;
      entries?: Array<{
        id?: string;
        title?: string;
        url?: string;
        thumbnails?: Array<{ url: string }>;
        duration?: number;
        uploader?: string;
      }>;
    }>(stdout);
    const entries = (raw.entries ?? []).map((e) => ({
      id: e.id ?? "",
      title: e.title ?? "Untitled",
      url: e.url ?? "",
      thumbnail: e.thumbnails?.at(-1)?.url ?? null,
      durationSeconds: e.duration ?? null,
      uploader: e.uploader ?? null,
    }));
    return {
      id: raw.id ?? "",
      title: raw.title ?? "Playlist",
      url,
      entryCount: entries.length,
      entries,
    };
  }

  /**
   * Downloads to `outputPath`, climbing the attempt ladder on transient failure.
   *
   * The download pass re-extracts the page, so it is exposed to exactly the
   * flakiness `run` guards against — and it is the more painful place to hit it,
   * because the user has already committed to the download by then. Each
   * attempt spawns a fresh process and hands it to `onProcess`, so cancellation
   * always reaches the one that is actually running.
   */
  async runDownload(input: RunDownloadInput): Promise<void> {
    await this.binaries.ensureReady();

    const attempts = buildAttempts(
      input.url,
      detectPlatform(input.url),
      this.config.ytdlpMaxAttempts,
    );
    let lastError = "";

    for (let i = 0; i < attempts.length; i++) {
      if (input.isCancelled?.()) throw new CancelledError();
      const attempt = attempts[i];
      try {
        const { child, done } = await this.spawnDownload(input, attempt);
        input.onProcess?.(child);
        await done;
        if (i > 0) {
          this.logger.log(
            `Download recovered on attempt ${i + 1}/${attempts.length} via "${attempt.label}": ${input.url}`,
          );
        }
        return;
      } catch (error) {
        // A cancelled job is a decision, not a failure — never retry it.
        if (error instanceof CancelledError || input.isCancelled?.()) throw error;

        lastError = rawErrorText(error);
        if (i === attempts.length - 1 || !isRetryable(lastError)) break;
        this.logger.warn(
          `Download attempt ${i + 1}/${attempts.length} ("${attempt.label}") failed, retrying: ${briefError(lastError)}`,
        );
        input.onRetry?.({
          attempt: i + 1,
          total: attempts.length,
          reason: briefError(lastError),
        });
        await sleep(retryDelayMs(i, this.config.ytdlpRetryBaseMs));
      }
    }

    throw new Error(friendlyYtdlpError(lastError));
  }

  /**
   * Builds args and spawns a single yt-dlp download writing to `outputPath`.
   * Progress is delivered via the `onProgress` callback.
   */
  async spawnDownload(
    input: {
      url: string;
      request: CreateDownloadRequest;
      outputPath: string;
      onProgress: (p: EngineProgress) => void;
    },
    attempt: Attempt = { url: input.url, args: [], label: "default" },
  ): Promise<SpawnedDownload> {
    await this.binaries.ensureReady();
    const inv = this.binaries.ytdlp;
    const args = this.buildDownloadArgs(attempt, input.request, input.outputPath);
    this.logger.debug(`yt-dlp ${args.join(" ")}`);

    // Detached on POSIX so cancellation can signal the whole process group —
    // yt-dlp does its work in a child of the process we spawn. See killTree.
    const child = spawn(inv.command, [...inv.argsPrefix, ...args], {
      windowsHide: true,
      detached: DETACH_CHILDREN,
    });

    const done = new Promise<void>((resolve, reject) => {
      let stderrTail = "";
      // Video and audio arrive as separate passes; present them as one bar.
      const aggregate = new ProgressAggregator();

      child.stdout?.on("data", (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/)) {
          const progress = parseProgressLine(line);
          if (progress) input.onProgress(aggregate.push(progress));
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderrTail = (stderrTail + data.toString()).slice(-4000);
      });

      // Rejections carry raw yt-dlp text, not the friendly message: the caller
      // classifies it for retry first, and only the final failure is translated.
      child.on("error", (err) => reject(err));

      child.on("close", (code, signal) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          reject(new CancelledError());
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderrTail || `exit code ${code}`));
        }
      });
    });

    return { child, done };
  }

  private buildDownloadArgs(
    attempt: Attempt,
    request: CreateDownloadRequest,
    outputPath: string,
  ): string[] {
    const args = [
      ...this.baseArgs(),
      ...this.attemptArgs(attempt),
      "--newline",
      "--progress-template",
      PROGRESS_TEMPLATE,
      "--force-overwrites",
      // Parallel fragment fetching — the single biggest download speed win
      // for HLS/DASH sources.
      "--concurrent-fragments",
      String(this.config.ytdlpConcurrentFragments),
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
      if (request.embedThumbnail) args.push("--embed-thumbnail", "--add-metadata");
    } else {
      const format = (request.format as VideoFormat) ?? "mp4";
      const quality = (request.quality as VideoQuality) ?? "highest";
      args.push(
        "-f",
        videoFormatSelector(quality),
        "--merge-output-format",
        VIDEO_FORMATS.includes(format) ? format : "mp4",
      );
      if (request.embedSubtitles) {
        args.push("--embed-subs", "--sub-langs", request.subtitleLang || "en.*,en");
      }
    }

    if (request.clipStart != null || request.clipEnd != null) {
      const start = formatClipTime(request.clipStart ?? 0);
      const end = request.clipEnd != null ? formatClipTime(request.clipEnd) : "inf";
      args.push("--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts");
    }

    args.push(attempt.url);
    return args;
  }

  private normalizeInfo(raw: RawInfo, url: string, platform: Platform): MediaInfo {
    const heights = new Set<number>();
    for (const f of raw.formats ?? []) {
      if (f.height && f.vcodec && f.vcodec !== "none") heights.add(f.height);
    }
    const videoQualities = [...heights]
      .sort((a, b) => b - a)
      .map((h) => `${h}p`)
      .filter((q): q is VideoQuality =>
        ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"].includes(q),
      );

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
        audio: [...AUDIO_QUALITIES],
      },
      formats: {
        video: [...VIDEO_FORMATS],
        audio: [...AUDIO_FORMATS],
      },
      subtitles,
    };
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Parses the first JSON document out of yt-dlp's stdout.
 *
 * `--dump-json` emits one object *per entry*, and a link we treat as a single
 * video can still resolve to several (Facebook share links, Instagram
 * carousels, X posts with multiple videos). A plain `JSON.parse` of the whole
 * buffer then throws on the second object's opening brace and the request fails
 * for a video that extracted perfectly well. The first document is the one the
 * URL named, so it is the one we want.
 */
function parseFirstJson<T>(stdout: string): T {
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

function videoFormatSelector(quality: VideoQuality): string {
  if (quality === "highest") return "bestvideo*+bestaudio/best";
  if (quality === "lowest") return "worstvideo*+worstaudio/worst";
  const height = parseInt(quality, 10);
  return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}

function formatClipTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec
    .toString()
    .padStart(2, "0")}`;
}

/** Maps raw yt-dlp stderr onto a human-readable message. */
export function friendlyYtdlpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  // A missing JS runtime produces both of these, and it is by far the more
  // common cause — check it before blaming the IP, so operators are not sent
  // hunting for cookies and proxies over a missing dependency.
  if (lower.includes("n challenge") || lower.includes("no supported javascript runtime"))
    return "The download engine is missing a JavaScript runtime, so the platform withheld every playable format. Install deno (or run the API on Node 22+) — see YTDLP_JS_RUNTIME.";
  if (lower.includes("not a bot") || lower.includes("sign in to confirm"))
    return "YouTube is asking this server to sign in before it will serve this video. It applies that check to some videos only, and server IP ranges fail it where a home connection passes — so it is not something retrying fixes. The server needs logged-in cookies (COOKIES_FILE / COOKIES_B64), a proof-of-origin token provider, or a residential proxy (YTDLP_PROXY).";
  if (lower.includes("unsupported url")) return "This URL is not supported.";
  if (lower.includes("video unavailable")) return "This video is unavailable or has been removed.";
  if (lower.includes("private video") || lower.includes("this video is private"))
    return "This video is private.";
  if (lower.includes("sign in to confirm your age") || lower.includes("age-restricted"))
    return "This video is age-restricted and cannot be downloaded.";
  if (lower.includes("requested format is not available"))
    return "The requested quality/format is not available for this media.";
  if (/geo[- ]restrict|not (made this video )?available (in|from) your (country|location)/.test(lower))
    return "This media is geo-restricted.";
  if (lower.includes("timed out") || lower.includes("timeout"))
    return "The request to the platform timed out. Please try again.";
  if (lower.includes("login required") || lower.includes("rate-limit") || lower.includes("429"))
    return "The platform is rate-limiting requests right now. Please try again later.";
  if (lower.includes("live event") || lower.includes("is live"))
    return "Live streams cannot be downloaded until they finish.";
  // Reaching here means every attempt in the ladder hit this, so the advice to
  // wait is genuine rather than a shrug — the platform is serving a page shape
  // the extractor cannot read right now.
  if (lower.includes("cannot parse data") || lower.includes("unable to extract"))
    return "The platform returned a page this downloader could not read. That is usually temporary — please try again in a minute.";

  const errLine = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("ERROR:"))
    .at(-1);
  if (errLine) return errLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "").trim() || "Download failed.";
  return "Download failed. Please check the URL and try again.";
}
