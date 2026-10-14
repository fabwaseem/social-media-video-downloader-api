import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { ChildProcess } from "child_process";
import Redis from "ioredis";
import { AppConfigService } from "../config/app-config.service";
import { hasExited, killTree } from "../common/utils/kill-tree";
import { MemoryQueue } from "./memory-queue";

export type JobHandler = (jobId: string) => Promise<void>;

interface DownloadPayload {
  jobId: string;
}

/**
 * Runs download jobs. Redis (BullMQ) is used when REDIS_URL is set and
 * reachable; otherwise jobs stay in memory for local runs and CI.
 */
@Injectable()
export class JobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueue.name);
  private readonly memory: MemoryQueue;
  private readonly processes = new Map<string, ChildProcess>();
  private readonly cancelled = new Set<string>();
  private handler: JobHandler | null = null;
  private bull: Queue<DownloadPayload> | null = null;
  private worker: Worker<DownloadPayload> | null = null;

  constructor(private readonly config: AppConfigService) {
    this.memory = new MemoryQueue(config.maxConcurrentJobs, (jobId, error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job ${jobId} crashed: ${message}`);
    });
  }

  setHandler(handler: JobHandler): void {
    this.handler = handler;
    this.startWorker();
  }

  async onModuleInit(): Promise<void> {
    await this.ensureQueue();
    this.startWorker();
  }

  private async ensureQueue(): Promise<void> {
    if (this.bull) return;
    const url = this.config.redisUrl;
    if (!url) {
      this.logger.log("REDIS_URL is unset; download queue is in-memory");
      return;
    }
    const probe = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    probe.on("error", () => undefined);
    try {
      await probe.connect();
      await probe.ping();
      await probe.quit();
      this.bull = new Queue<DownloadPayload>("downloads", {
        connection: { url, maxRetriesPerRequest: null },
      });
      this.bull.on("error", (err) => this.logger.error(`download queue: ${err.message}`));
      this.logger.log("Download queue using Redis");
    } catch (error) {
      this.bull = null;
      this.logger.warn(
        `Redis unavailable, using in-memory queue: ${error instanceof Error ? error.message : String(error)}`,
      );
      await probe.quit().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.bull?.close().catch(() => undefined);
  }

  async pendingCount(): Promise<number> {
    if (!this.bull) return this.memory.size;
    const counts = await this.bull.getJobCounts("waiting", "active", "delayed", "prioritized");
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
  }

  /** True when BullMQ still has this job and will run it without our help. */
  async holds(jobId: string): Promise<boolean> {
    if (!this.bull) return false;
    const job = await this.bull.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized" || state === "waiting-children") {
      return true;
    }
    await job.remove().catch(() => undefined);
    return false;
  }

  async enqueue(jobId: string): Promise<void> {
    if (this.bull) {
      const existing = await this.bull.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") return;
        await existing.remove().catch(() => undefined);
      }
      await this.bull.add("download", { jobId }, { jobId, removeOnComplete: 200, removeOnFail: 200, attempts: 1 });
      return;
    }
    this.memory.enqueue(jobId, () => this.dispatch(jobId));
  }

  registerProcess(jobId: string, child: ChildProcess): void {
    this.processes.set(jobId, child);
  }

  releaseProcess(jobId: string): void {
    this.processes.delete(jobId);
  }

  wasCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId);
  }

  async cancel(jobId: string): Promise<"removed" | "killed" | "untracked"> {
    this.cancelled.add(jobId);
    if (this.memory.remove(jobId)) return "removed";
    const child = this.processes.get(jobId);
    if (child) {
      killTree(child, "SIGTERM");
      setTimeout(() => {
        if (!hasExited(child)) killTree(child, "SIGKILL");
      }, 5000).unref?.();
      return "killed";
    }
    if (this.bull) {
      const job = await this.bull.getJob(jobId).catch(() => undefined);
      if (job) {
        const state = await job.getState();
        if (state === "waiting" || state === "delayed") {
          await job.remove().catch(() => undefined);
          return "removed";
        }
      }
    }
    if (this.memory.isRunning(jobId)) return "untracked";
    return "untracked";
  }

  /**
   * setHandler and onModuleInit can run in either order. The worker starts
   * once, and only once both the handler and the Redis queue exist.
   */
  private startWorker(): void {
    if (this.worker || !this.bull || !this.handler) return;
    this.worker = new Worker<DownloadPayload>(
      "downloads",
      async (job: Job<DownloadPayload>) => {
        await this.dispatch(job.data.jobId);
      },
      {
        connection: { url: this.config.redisUrl, maxRetriesPerRequest: null },
        concurrency: this.config.maxConcurrentJobs,
      },
    );
    this.worker.on("error", (err) => this.logger.error(`download worker: ${err.message}`));
  }

  private async dispatch(jobId: string): Promise<void> {
    try {
      if (!this.handler) throw new Error("Download handler is not registered");
      await this.handler(jobId);
    } finally {
      this.processes.delete(jobId);
      this.cancelled.delete(jobId);
    }
  }
}
