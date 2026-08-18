import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import { AppConfigService } from "../config/app-config.service";
import { contentDisposition } from "../common/utils/filename";

/**
 * Where finished downloads live.
 *
 * Keeping files on the server is the wrong shape for this service twice over:
 * the container's disk is ephemeral, so a redeploy silently voids every link
 * handed out, and every byte served leaves through the API (and, before it,
 * the web proxy) instead of going straight from storage to the browser.
 * Offloading to an S3-compatible bucket fixes both — and because the browser
 * fetches a presigned URL directly, HTTP range requests work end to end, which
 * is what makes an interrupted download resumable.
 *
 * The local driver stays as the default so development needs no credentials.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** True when finished files are offloaded to a bucket. */
  get remote(): boolean {
    return this.config.storageDriver === "r2" && this.client !== null;
  }

  async onModuleInit(): Promise<void> {
    if (this.config.storageDriver !== "r2") {
      this.logger.log("Storage driver: local disk");
      return;
    }
    const { accountId, accessKeyId, secretAccessKey, bucket, endpoint } = this.config.r2;
    if (!accessKeyId || !secretAccessKey || !bucket || (!accountId && !endpoint)) {
      this.logger.error(
        "STORAGE_DRIVER=r2 but R2 credentials are incomplete — falling back to local disk. " +
          "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
      );
      return;
    }

    this.client = new S3Client({
      region: "auto",
      endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // R2 rejects the newer streaming checksum headers the v3 SDK adds by
      // default; ask for them only when a request actually requires one.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    this.logger.log(`Storage driver: R2 (bucket ${bucket})`);
    await this.ensureLifecycleRule();
  }

  /**
   * Applies the retention rule so expiry is enforced by the bucket itself.
   *
   * The sweeper in CleanupService can only delete what its database still
   * knows about; a row lost to a failed write would leave the object paying
   * rent forever. A bucket-side rule has no such blind spot, so the two
   * together mean nothing outlives its TTL.
   */
  private async ensureLifecycleRule(): Promise<void> {
    const days = this.config.fileRetentionDays;
    try {
      await this.client!.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.config.r2.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: "vidyoza-expire-downloads",
                Status: "Enabled",
                Filter: { Prefix: "" },
                Expiration: { Days: days },
                // Reclaims the parts of uploads that died mid-flight; without
                // this they are invisible and billable indefinitely.
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
              },
            ],
          },
        }),
      );
      this.logger.log(`Bucket lifecycle: objects expire after ${days} day(s)`);
    } catch (error) {
      // Not fatal: a token without lifecycle permission still uploads fine,
      // and CleanupService keeps deleting on its own schedule.
      this.logger.warn(
        `Could not apply bucket lifecycle rule (objects still expire via cleanup): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Uploads a finished file and returns its object key.
   *
   * Multipart is used throughout rather than only for large files, because the
   * interesting case here is exactly the large one — a long video is where a
   * single PUT would stall a whole request and where a retry has to resume
   * rather than restart.
   */
  async upload(localPath: string, key: string, contentType: string): Promise<void> {
    if (!this.client) throw new Error("Remote storage is not configured.");
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.r2.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  /**
   * A time-limited URL the browser can fetch directly.
   *
   * `ResponseContentDisposition` is what turns the opaque object key back into
   * the title the user expects on disk, and it has to be set here rather than
   * at upload time so one stored object can be served under any filename.
   */
  async signedUrl(key: string, downloadName: string): Promise<string> {
    if (!this.client) throw new Error("Remote storage is not configured.");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.r2.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(downloadName),
      }),
      { expiresIn: this.config.signedUrlTtlSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.r2.bucket, Key: key }),
    );
  }

  /** Object metadata, or null when the key is absent (expired or never stored). */
  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    if (!this.client) return null;
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.r2.bucket, Key: key }),
      );
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch {
      return null;
    }
  }

  /** Small text objects (cookie jars), kept out of the media namespace. */
  async putText(key: string, text: string, contentType = "text/plain"): Promise<void> {
    if (!this.client) throw new Error("Remote storage is not configured.");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.r2.bucket,
        Key: key,
        Body: text,
        ContentType: contentType,
      }),
    );
  }

  /** Reads a text object, or null when absent. */
  async getText(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.r2.bucket, Key: key }),
      );
      return (await out.Body?.transformToString()) ?? null;
    } catch {
      return null;
    }
  }

  /** Removes the local copy once the bytes are safely in the bucket. */
  async discardLocal(path: string): Promise<void> {
    await fs.unlink(path).catch(() => undefined);
  }
}
