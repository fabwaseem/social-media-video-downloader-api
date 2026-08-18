import { Injectable, Logger } from "@nestjs/common";
import type { ChildProcess } from "child_process";
import { AppConfigService } from "../config/app-config.service";
import { hasExited, killTree } from "../common/utils/kill-tree";

interface QueuedJob {
  jobId: string;
  run: () => Promise<void>;
}

/**
 * FIFO job queue with bounded concurrency plus a registry of running
 * child processes so jobs can be cancelled at any stage.
 */
@Injectable()
export class JobQueue {
  private readonly logger = new Logger(JobQueue.name);
  private readonly queue: QueuedJob[] = [];
  private readonly running = new Set<string>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly config: AppConfigService) {}

  get size(): number {
    return this.queue.length + this.running.size;
  }

  enqueue(jobId: string, run: () => Promise<void>): void {
    this.queue.push({ jobId, run });
    this.pump();
  }

  registerProcess(jobId: string, child: ChildProcess): void {
    this.processes.set(jobId, child);
  }

  releaseProcess(jobId: string): void {
    this.processes.delete(jobId);
  }

  /** True when the job was cancelled before or during execution. */
  wasCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId);
  }

  /**
   * Cancels a job. Returns "removed" when it was still queued,
   * "killed" when a running process was terminated, "untracked" otherwise.
   */
  cancel(jobId: string): "removed" | "killed" | "untracked" {
    const index = this.queue.findIndex((j) => j.jobId === jobId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.cancelled.add(jobId);
      return "removed";
    }
    const child = this.processes.get(jobId);
    if (child) {
      this.cancelled.add(jobId);
      killTree(child, "SIGTERM");
      setTimeout(() => {
        // `child.killed` only records that a signal was sent, so the old check
        // never escalated. Exit status is the question actually being asked.
        if (!hasExited(child)) killTree(child, "SIGKILL");
      }, 5000).unref?.();
      return "killed";
    }
    if (this.running.has(jobId)) {
      this.cancelled.add(jobId);
      return "untracked";
    }
    return "untracked";
  }

  private pump(): void {
    while (this.running.size < this.config.maxConcurrentJobs && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running.add(job.jobId);
      job
        .run()
        .catch((err) =>
          this.logger.error(`Job ${job.jobId} crashed: ${err?.message ?? String(err)}`),
        )
        .finally(() => {
          this.running.delete(job.jobId);
          this.processes.delete(job.jobId);
          this.cancelled.delete(job.jobId);
          this.pump();
        });
    }
  }
}
