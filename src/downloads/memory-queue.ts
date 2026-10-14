interface QueuedJob {
  jobId: string;
  run: () => Promise<void>;
}

/** FIFO queue with a fixed number of workers. Used when Redis is not configured. */
export class MemoryQueue {
  private readonly queue: QueuedJob[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly concurrency: number,
    private readonly onError: (jobId: string, error: unknown) => void,
  ) {}

  get size(): number {
    return this.queue.length + this.running.size;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  enqueue(jobId: string, run: () => Promise<void>): void {
    this.queue.push({ jobId, run });
    this.pump();
  }

  /** Drops a job that has not started. Returns false when it is already running. */
  remove(jobId: string): boolean {
    const index = this.queue.findIndex((job) => job.jobId === jobId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      this.running.add(job.jobId);
      job
        .run()
        .catch((error: unknown) => this.onError(job.jobId, error))
        .finally(() => {
          this.running.delete(job.jobId);
          this.pump();
        });
    }
  }
}
