import { Injectable, Logger } from "@nestjs/common";
import type { ChannelTab, CollectionInfo, CreateDownloadRequest, MediaInfo, PlaylistInfo } from "@vidyoza/shared";
import { detectPlatform } from "@vidyoza/shared";
import { ChildProcess, execFile, spawn } from "child_process";
import * as fsSync from "fs";
import { promisify } from "util";
import { resolveSourceUrl, SsrfError } from "../common/http/safe-fetch";
import { AppConfigService } from "../config/app-config.service";
import { DETACH_CHILDREN } from "../common/utils/kill-tree";
import { BinariesService } from "./binaries.service";
import { EngineProgress, ProgressAggregator, parseProgressLine } from "./progress";
import {
  Attempt,
  DESKTOP_UA,
  briefError,
  buildAttempts,
  isKnownTransient,
  isRetryable,
  rawErrorText,
  retryDelayMs,
  sleep,
} from "./resilience";
import { YtdlpArgContext, buildBaseArgs, buildDownloadArgs, filterAttemptArgs } from "./ytdlp/args";
import { asEngineError } from "./ytdlp/errors";
import { RawCollection, RawInfo, bestThumbnail, normalizeEntry, normalizeInfo, parseFirstJson } from "./ytdlp/normalize";

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

export { friendlyYtdlpError, EngineError } from "./ytdlp/errors";

export class CancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "CancelledError";
  }
}

@Injectable()
export class YtdlpService {
  private readonly logger = new Logger(YtdlpService.name);

  constructor(
    private readonly binaries: BinariesService,
    private readonly config: AppConfigService,
  ) {}

  private argContext(): YtdlpArgContext {
    const cookies = this.binaries.cookiesPath;
    return {
      verbose: this.config.ytdlpVerbose,
      jsRuntime: this.binaries.jsRuntime,
      pluginDir: this.binaries.pluginDir,
      cookiesPath: cookies && fsSync.existsSync(cookies) ? cookies : "",
      potBaseUrl: this.config.ytdlpPotBaseUrl,
      proxy: this.config.ytdlpProxy,
      forceIpv4: this.config.ytdlpForceIpv4,
      ffmpegPath: this.binaries.ffmpegPath,
      extraArgs: this.config.ytdlpExtraArgs,
      concurrentFragments: this.config.ytdlpConcurrentFragments,
    };
  }

  /** Expands short links and refuses private redirect targets before yt-dlp fetches. */
  private async publicSourceUrl(url: string): Promise<string> {
    try {
      return await resolveSourceUrl(url, {
        headers: { "User-Agent": DESKTOP_UA },
        timeoutMs: 20_000,
      });
    } catch (error) {
      if (error instanceof SsrfError) throw new Error("This URL is not allowed.");
      throw error;
    }
  }

  private async run(
    opArgs: string[],
    opts: { url: string; playlist?: boolean; timeoutMs?: number },
  ): Promise<string> {
    await this.binaries.ensureReady();
    const url = await this.publicSourceUrl(opts.url);
    const ctx = this.argContext();
    const attempts = buildAttempts(url, detectPlatform(url), this.config.ytdlpMaxAttempts);
    const timeout = opts.timeoutMs ?? 60_000;
    let lastError = "";

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        const inv = this.binaries.ytdlp;
        const args = [
          ...buildBaseArgs(ctx, opts.playlist),
          ...filterAttemptArgs(ctx.extraArgs, attempt),
          ...opArgs,
          "--",
          attempt.url,
        ];
        const { stdout } = await execFileAsync(inv.command, [...inv.argsPrefix, ...args], {
          timeout,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        });
        if (i > 0) {
          this.logger.log(`Recovered on attempt ${i + 1}/${attempts.length} via "${attempt.label}": ${url}`);
        }
        return stdout;
      } catch (error) {
        lastError = rawErrorText(error);
        if (this.config.ytdlpVerbose) {
          this.logger.warn(`yt-dlp stderr (attempt ${i + 1}):\n${lastError.slice(-6000)}`);
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

    throw asEngineError(lastError);
  }

  /** Uncached single-engine extraction. Caching lives in ExtractionService. */
  async extractInfo(url: string): Promise<MediaInfo> {
    const platform = detectPlatform(url);
    const stdout = await this.run(["--dump-json", "--no-download"], { url });
    return normalizeInfo(parseFirstJson<RawInfo>(stdout), url, platform ?? "youtube");
  }

  async getCollectionInfo(input: {
    url: string;
    sourceUrl: string;
    kind: "playlist" | "channel";
    tab: ChannelTab | null;
    offset: number;
    limit: number;
  }): Promise<CollectionInfo> {
    const { url, sourceUrl, kind, tab, offset, limit } = input;
    const end = offset + limit;
    const stdout = await this.run(
      ["--dump-single-json", "--flat-playlist", "--no-download", "--playlist-items", `${offset}:${end}`],
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
      entries: page.map((entry) => normalizeEntry(entry)),
    };
  }

  async getPlaylistInfo(url: string, limit = 100): Promise<PlaylistInfo> {
    const stdout = await this.run(
      ["--dump-single-json", "--flat-playlist", "--no-download", "--playlist-items", `1:${limit}`],
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
    const entries = (raw.entries ?? []).map((entry) => ({
      id: entry.id ?? "",
      title: entry.title ?? "Untitled",
      url: entry.url ?? "",
      thumbnail: entry.thumbnails?.at(-1)?.url ?? null,
      durationSeconds: entry.duration ?? null,
      uploader: entry.uploader ?? null,
    }));
    return {
      id: raw.id ?? "",
      title: raw.title ?? "Playlist",
      url,
      entryCount: entries.length,
      entries,
    };
  }

  async runDownload(input: RunDownloadInput): Promise<void> {
    await this.binaries.ensureReady();
    const url = await this.publicSourceUrl(input.url);
    const attempts = buildAttempts(url, detectPlatform(url), this.config.ytdlpMaxAttempts);
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
            `Download recovered on attempt ${i + 1}/${attempts.length} via "${attempt.label}": ${url}`,
          );
        }
        return;
      } catch (error) {
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

    throw asEngineError(lastError);
  }

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

    const child = spawn(inv.command, [...inv.argsPrefix, ...args], {
      windowsHide: true,
      detached: DETACH_CHILDREN,
    });

    const done = new Promise<void>((resolve, reject) => {
      let stderrTail = "";
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

      child.on("error", (err) => reject(err));
      child.on("close", (code, signal) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") reject(new CancelledError());
        else if (code === 0) resolve();
        else reject(new Error(stderrTail || `exit code ${code}`));
      });
    });

    return { child, done };
  }

  private buildDownloadArgs(attempt: Attempt, request: CreateDownloadRequest, outputPath: string): string[] {
    return buildDownloadArgs(this.argContext(), attempt, request, outputPath);
  }
}
