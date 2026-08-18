import { Injectable, Logger } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * A single 64-bit key identifying the storage-accounting lock.
 *
 * Postgres advisory locks are global to the database, so the number itself is
 * arbitrary — it only has to be unique among locks this application takes.
 */
const QUOTA_LOCK_KEY = 8274651n;

/** Reservation outcome. Objects listed in `evicted` are no longer accounted for. */
export interface Reservation {
  /** Keys whose rows were expired to make room; the caller deletes them. */
  evicted: string[];
  /** Bytes accounted for after this reservation. */
  usedBytes: number;
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * Keeps stored bytes under a hard ceiling.
 *
 * Object storage bills for what is kept, and a busy day can quietly push a
 * bucket past its free allowance. Retention alone cannot prevent that — it
 * bounds how long a file lives, not how many arrive — so the ceiling has to be
 * enforced at the moment of upload, evicting the oldest finished downloads
 * when a new one will not fit.
 *
 * The accounting has to be race-free or it is worthless: two jobs finishing at
 * once would each read the same "there is room" and both upload, and the
 * ceiling would be exceeded by exactly the amount nobody was watching. Every
 * reservation therefore runs inside one transaction holding a Postgres
 * advisory lock, which serialises them across every worker and every replica,
 * not merely within one process.
 *
 * A reservation writes `storageKey` before the upload starts, so space in
 * flight is visible to the next reserver rather than appearing only once the
 * upload lands.
 */
@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Bytes currently accounted for in the bucket. */
  async usedBytes(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM("fileSizeBytes"), 0)::bigint AS total
      FROM "Download"
      WHERE "storageKey" IS NOT NULL AND "status" <> 'EXPIRED'
    `;
    return Number(row?.total ?? 0n);
  }

  /**
   * Claims `bytes` of bucket space for a job, evicting oldest-first if needed.
   *
   * Returns the keys that were evicted; the caller deletes those objects after
   * the transaction commits, because an object delete cannot be rolled back
   * and must never happen for a transaction that later aborts.
   *
   * Throws `QuotaExceededError` when the file cannot fit even with the bucket
   * emptied — evicting everything for a file that still will not fit would
   * destroy other users' downloads for nothing.
   */
  async reserve(jobId: string, key: string, bytes: number): Promise<Reservation> {
    const quota = this.config.storageQuotaBytes;

    if (bytes > quota) {
      throw new QuotaExceededError(
        `This file is ${mb(bytes)} MB, which alone exceeds the ${mb(quota)} MB storage limit.`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
      // Serialises every reservation database-wide. Held until this
      // transaction ends, so the read-decide-write below is atomic.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUOTA_LOCK_KEY}::bigint)`;

      const [usage] = await tx.$queryRaw<Array<{ total: bigint | null }>>`
        SELECT COALESCE(SUM("fileSizeBytes"), 0)::bigint AS total
        FROM "Download"
        WHERE "storageKey" IS NOT NULL AND "status" <> 'EXPIRED'
      `;
      let used = Number(usage?.total ?? 0n);
      const evicted: string[] = [];

      if (used + bytes > quota) {
        // Only finished downloads are evictable: a row that is still uploading
        // has no object to reclaim yet, and expiring it would strand the job
        // that is mid-flight.
        const candidates = await tx.download.findMany({
          where: {
            storageKey: { not: null },
            status: "COMPLETED",
            id: { not: jobId },
          },
          orderBy: { completedAt: "asc" },
          select: { id: true, storageKey: true, fileSizeBytes: true },
        });

        for (const candidate of candidates) {
          if (used + bytes <= quota) break;
          await tx.download.update({
            where: { id: candidate.id },
            data: { status: "EXPIRED", expiresAt: new Date() },
          });
          used -= Number(candidate.fileSizeBytes ?? 0n);
          if (candidate.storageKey) evicted.push(candidate.storageKey);
        }
      }

      if (used + bytes > quota) {
        throw new QuotaExceededError(
          "Storage is full and no older downloads could be freed. Please try again shortly.",
        );
      }

      // Recording the key now is what makes this reservation visible to the
      // next reserver waiting on the lock.
      await tx.download.update({
        where: { id: jobId },
        data: { storageKey: key, fileSizeBytes: BigInt(bytes) },
      });

        return { evicted, usedBytes: used + bytes };
      },
      // Reservations serialise on the advisory lock, so a queue forms under
      // load. Prisma's 2s default wait would reject the tail of that queue as
      // a timeout — indistinguishable, from the caller, from a full bucket.
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  /**
   * Brings total storage back under the ceiling, oldest-first.
   *
   * `reserve` already prevents the quota being crossed on the way in; this is
   * the backstop for the ways it can be crossed without an upload — the ceiling
   * being lowered, or accounting drifting after a partial failure. Returns the
   * keys whose objects the caller should delete.
   */
  async enforce(): Promise<string[]> {
    const quota = this.config.storageQuotaBytes;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUOTA_LOCK_KEY}::bigint)`;

        const [usage] = await tx.$queryRaw<Array<{ total: bigint | null }>>`
          SELECT COALESCE(SUM("fileSizeBytes"), 0)::bigint AS total
          FROM "Download"
          WHERE "storageKey" IS NOT NULL AND "status" <> 'EXPIRED'
        `;
        let used = Number(usage?.total ?? 0n);
        if (used <= quota) return [];

        const candidates = await tx.download.findMany({
          where: { storageKey: { not: null }, status: "COMPLETED" },
          orderBy: { completedAt: "asc" },
          select: { id: true, storageKey: true, fileSizeBytes: true },
        });

        const evicted: string[] = [];
        for (const candidate of candidates) {
          if (used <= quota) break;
          await tx.download.update({
            where: { id: candidate.id },
            data: { status: "EXPIRED", expiresAt: new Date() },
          });
          used -= Number(candidate.fileSizeBytes ?? 0n);
          if (candidate.storageKey) evicted.push(candidate.storageKey);
        }
        return evicted;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  /** Releases a reservation whose upload failed, so the space is not held. */
  async release(jobId: string): Promise<void> {
    await this.prisma.download
      .update({ where: { id: jobId }, data: { storageKey: null } })
      .catch(() => undefined);
  }

  /** Quota headroom, for /health. */
  async status(): Promise<{ usedBytes: number; quotaBytes: number; usedPercent: number }> {
    const quotaBytes = this.config.storageQuotaBytes;
    const usedBytes = await this.usedBytes();
    return {
      usedBytes,
      quotaBytes,
      usedPercent: quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0,
    };
  }
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
