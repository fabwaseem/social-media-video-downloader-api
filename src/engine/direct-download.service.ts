import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { createWriteStream } from "fs";
import * as fs from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { CancelledError } from "./ytdlp.service";
import { BinariesService } from "./binaries.service";
import type { EngineProgress } from "./progress";

const execFileAsync = promisify(execFile);

/**
 * Downloads a direct media URL over plain HTTP.
 *
 * This is the download half of the provider fallback: once a provider has
 * resolved a ready-to-fetch CDN URL, no extractor is involved any more, so a
 * platform that is refusing to serve its own watch page cannot block it. There
 * is no format ladder here — the provider hands over one rendition, and the
 * point is finishing the download rather than picking the best of six.
 */
@Injectable()
export class DirectDownloadService {
  private readonly logger = new Logger(DirectDownloadService.name);

  constructor(private readonly binaries: BinariesService) {}

  /**
   * Fetches `url` to `outputPath`, reporting progress as bytes arrive.
   * Returns the path actually written.
   */
  async download(input: {
    url: string;
    outputPath: string;
    headers?: Record<string, string>;
    onProgress?: (p: EngineProgress) => void;
    isCancelled?: () => boolean;
  }): Promise<void> {
    const controller = new AbortController();
    const response = await fetch(input.url, {
      headers: input.headers ?? {},
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Media host returned HTTP ${response.status}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || 0;
    let downloadedBytes = 0;
    let lastEmit = 0;
    const startedAt = Date.now();

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      if (input.isCancelled?.()) {
        controller.abort();
        return;
      }
      const now = Date.now();
      // Throttled: a fast CDN delivers chunks far quicker than any UI can show.
      if (input.onProgress && now - lastEmit > 250) {
        lastEmit = now;
        const seconds = Math.max(0.001, (now - startedAt) / 1000);
        const speed = downloadedBytes / seconds;
        input.onProgress({
          downloadedBytes,
          totalBytes,
          speed,
          eta: totalBytes > downloadedBytes && speed > 0 ? (totalBytes - downloadedBytes) / speed : 0,
          percentage:
            totalBytes > 0
              ? Math.min(99.9, Math.round((downloadedBytes / totalBytes) * 1000) / 10)
              : 0,
        });
      }
    });

    try {
      await pipeline(source, createWriteStream(input.outputPath));
    } catch (error) {
      await fs.unlink(input.outputPath).catch(() => undefined);
      if (input.isCancelled?.()) throw new CancelledError();
      throw new Error(
        `Direct download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (input.isCancelled?.()) {
      await fs.unlink(input.outputPath).catch(() => undefined);
      throw new CancelledError();
    }
  }

  /**
   * Converts a downloaded file to another container/codec with ffmpeg.
   *
   * Providers only ever hand back the platform's own rendition — an mp4 — so a
   * request for mp3 still has to be satisfied locally. The source is removed
   * once the conversion lands so the job leaves exactly one file behind.
   */
  async convert(sourcePath: string, targetPath: string, kind: "audio" | "video"): Promise<void> {
    const ffmpeg = this.binaries.ffmpegPath || "ffmpeg";
    const args =
      kind === "audio"
        ? ["-y", "-i", sourcePath, "-vn", "-q:a", "0", targetPath]
        : ["-y", "-i", sourcePath, "-c", "copy", targetPath];

    try {
      await execFileAsync(ffmpeg, args, { timeout: 300_000, windowsHide: true });
    } catch (error) {
      throw new Error(
        `Could not convert the downloaded media: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (sourcePath !== targetPath) await fs.unlink(sourcePath).catch(() => undefined);
  }
}
