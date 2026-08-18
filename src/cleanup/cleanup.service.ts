import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as fs from "fs/promises";
import { join } from "path";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { StorageQuotaService } from "../storage/storage-quota.service";

/**
 * Housekeeping: expires finished downloads past their TTL, removes their
 * files, and sweeps orphaned/partial files left on disk.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    await this.expireCompletedDownloads();
    await this.enforceStorageQuota();
    await this.sweepOrphanFiles();
  }

  private async expireCompletedDownloads(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.download.findMany({
      where: { status: "COMPLETED", expiresAt: { lt: now } },
      take: 200,
    });
    if (expired.length === 0) return;

    for (const record of expired) {
      // The bucket lifecycle rule expires objects on its own; deleting here as
      // well means space is reclaimed the moment the TTL lands rather than at
      // the next lifecycle pass, and it keeps behaviour identical whether or
      // not the rule could be applied.
      if (record.storageKey) {
        await this.storage.delete(record.storageKey).catch(() => undefined);
      }
      if (record.filename) {
        await fs
          .unlink(join(this.config.downloadsDir, record.filename))
          .catch(() => undefined);
      }
      await this.prisma.download.update({
        where: { id: record.id },
        data: { status: "EXPIRED" },
      });
    }
    this.logger.log(`Expired ${expired.length} download(s)`);
  }

  /**
   * Backstop for the ceiling enforced at upload time.
   *
   * Uploads cannot cross the quota on their own, but it can be crossed without
   * one — by lowering the limit, or by accounting drifting after a partial
   * failure. Catching that here means storage cannot sit over the line for
   * longer than one sweep.
   */
  private async enforceStorageQuota(): Promise<void> {
    if (!this.storage.remote) return;
    let evicted: string[] = [];
    try {
      evicted = await this.quota.enforce();
    } catch (error) {
      this.logger.warn(`Storage quota sweep failed: ${(error as Error).message}`);
      return;
    }
    if (evicted.length === 0) return;
    for (const key of evicted) {
      await this.storage.delete(key).catch(() => undefined);
    }
    this.logger.log(`Storage quota sweep evicted ${evicted.length} download(s)`);
  }

  /** Removes files on disk with no live DB record and stale partials. */
  private async sweepOrphanFiles(): Promise<void> {
    const dir = this.config.downloadsDir;
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return;
    }

    const ttlMs = this.config.fileTtlMinutes * 60 * 1000;
    const now = Date.now();
    let removed = 0;

    const live = await this.prisma.download.findMany({
      where: { status: { in: ["COMPLETED", "DOWNLOADING", "CONVERTING", "QUEUED"] } },
      select: { filename: true },
    });
    const liveNames = new Set(live.map((r) => r.filename).filter(Boolean) as string[]);

    for (const file of files) {
      const isPartial = file.endsWith(".part") || file.endsWith(".ytdl");
      try {
        const stat = await fs.stat(join(dir, file));
        const age = now - stat.mtimeMs;
        const stale = isPartial ? age > 60 * 60 * 1000 : age > ttlMs * 2;
        if (stale && !liveNames.has(file)) {
          await fs.unlink(join(dir, file));
          removed++;
        }
      } catch {
        // file disappeared mid-sweep — fine
      }
    }
    if (removed > 0) this.logger.log(`Swept ${removed} orphan file(s)`);
  }
}
