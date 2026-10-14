import { HttpStatus, Injectable } from "@nestjs/common";
import { createReadStream, type ReadStream } from "fs";
import * as fs from "fs/promises";
import { AppConfigService } from "../config/app-config.service";
import { ApiException, ErrorCode } from "../common/errors";
import {
  contentDisposition,
  contentTypeFor,
  safeJoin,
} from "../common/utils/filename";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { verifyFileLink } from "./download-link";

export interface FileStreamResult {
  stream: ReadStream;
  status: number;
  headers: Record<string, string | number>;
}

/**
 * Either a redirect to storage or a local stream.
 *
 * The redirect is what keeps large files off our bandwidth: the access check
 * still happens here, but once it passes the browser is sent straight to the
 * bucket, so the bytes never traverse the API or the web proxy. Range requests
 * are then answered by storage itself, which is what makes a half-finished
 * download resumable.
 */
export type FileResponse =
  | { kind: "redirect"; url: string }
  | ({ kind: "stream" } & FileStreamResult);

@Injectable()
export class FilesService {
  constructor(
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The link is the credential. The signature is checked before the job is
   * loaded so a guessed id does not reveal whether a download exists.
   */
  private async authorizedFile(
    jobId: string,
    exp: string | undefined,
    sig: string | undefined,
  ): Promise<{ filename: string; key: string }> {
    if (!verifyFileLink(jobId, exp, sig, this.config.fileLinkSecret)) {
      throw new ApiException(
        ErrorCode.FILE_NOT_FOUND,
        "Invalid or expired download link",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const record = await this.prisma.download.findUnique({ where: { id: jobId } });
    if (!record?.filename || record.status !== "COMPLETED") {
      throw new ApiException(
        ErrorCode.FILE_NOT_FOUND,
        "File not found or expired",
        HttpStatus.NOT_FOUND,
      );
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new ApiException(ErrorCode.FILE_EXPIRED, "File not found or expired", HttpStatus.GONE);
    }
    return { filename: record.filename, key: record.storageKey ?? record.filename };
  }

  /**
   * Rejects anything that is not a bare media filename.
   *
   * The bucket holds more than finished downloads — the cookie jar lives there
   * too — and this endpoint presigns whatever key it is handed. A request for
   * `internal/cookies.txt` would otherwise be answered with a working download
   * link to the server's credentials. Media keys never contain a separator, so
   * refusing separators keeps this endpoint to exactly its own namespace.
   */
  private assertMediaKey(decoded: string): void {
    if (decoded.includes("/") || decoded.includes("\\") || decoded.startsWith(".")) {
      throw new ApiException(ErrorCode.FILE_NOT_FOUND, "Invalid filename", HttpStatus.BAD_REQUEST);
    }
  }

  private async resolve(filename: string): Promise<{ path: string; size: number }> {
    const decoded = decodeURIComponent(filename);
    const target = safeJoin(this.config.downloadsDir, decoded);
    if (!target) {
      throw new ApiException(ErrorCode.FILE_NOT_FOUND, "Invalid filename", HttpStatus.BAD_REQUEST);
    }
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error("not a file");
      return { path: target, size: stat.size };
    } catch {
      throw new ApiException(
        ErrorCode.FILE_NOT_FOUND,
        "File not found or expired",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async getMetadata(jobId: string, exp?: string, sig?: string) {
    const { filename, key } = await this.authorizedFile(jobId, exp, sig);
    this.assertMediaKey(key);

    if (this.storage.remote) {
      const head = await this.storage.head(key);
      if (head) {
        return {
          filename,
          size: head.size,
          contentType: head.contentType ?? contentTypeFor(filename),
          createdAt: null,
          modifiedAt: null,
        };
      }
    }

    const { path, size } = await this.resolve(filename);
    const stat = await fs.stat(path);
    return {
      filename,
      size,
      contentType: contentTypeFor(filename),
      createdAt: stat.birthtime,
      modifiedAt: stat.mtime,
    };
  }

  async stream(jobId: string, exp: string | undefined, sig: string | undefined, range?: string): Promise<FileResponse> {
    const { filename, key } = await this.authorizedFile(jobId, exp, sig);
    this.assertMediaKey(key);

    // Remote first, but fall through to disk when the object is missing: a job
    // that finished just before the switch to bucket storage — or one whose
    // upload failed and kept its local copy — still has to be downloadable.
    if (this.storage.remote && (await this.storage.head(key))) {
      return { kind: "redirect", url: await this.storage.signedUrl(key, filename) };
    }

    const { path, size } = await this.resolve(filename);

    const common = {
      "Content-Type": contentTypeFor(filename),
      "Content-Disposition": contentDisposition(filename),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0",
      "X-Content-Type-Options": "nosniff",
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
        if (start <= end && start < size) {
          return {
            kind: "stream",
            stream: createReadStream(path, { start, end }),
            status: HttpStatus.PARTIAL_CONTENT,
            headers: {
              ...common,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": end - start + 1,
            },
          };
        }
      }
      // Unsatisfiable range
      throw new ApiException(
        ErrorCode.FILE_NOT_FOUND,
        "Requested range not satisfiable",
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }

    return {
      kind: "stream",
      stream: createReadStream(path),
      status: HttpStatus.OK,
      headers: { ...common, "Content-Length": size },
    };
  }
}
