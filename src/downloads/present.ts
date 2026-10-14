import type { DownloadJob, JobStatus } from "@downloader/shared";
import type { Download } from "../generated/prisma/client";
import { fileLinkPath } from "../files/download-link";

export function toDownloadJob(record: Download, secret: string, ttlSeconds: number): DownloadJob {
  return {
    id: record.id,
    platform: record.platform as DownloadJob["platform"],
    url: record.url,
    kind: record.kind as DownloadJob["kind"],
    status: record.status as JobStatus,
    title: record.title,
    thumbnail: record.thumbnail,
    quality: record.quality,
    format: record.format,
    filename: record.filename,
    fileUrl:
      record.status === "COMPLETED" && record.filename
        ? fileLinkPath(record.id, secret, ttlSeconds)
        : null,
    fileSizeBytes: record.fileSizeBytes != null ? Number(record.fileSizeBytes) : null,
    error: record.error,
    errorCode: record.errorCode,
    progress: record.progress,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}
