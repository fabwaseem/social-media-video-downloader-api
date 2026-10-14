import { execFileSync } from "child_process";
import { Queue } from "bullmq";
import Redis from "ioredis";
import type { AppConfigService } from "../src/config/app-config.service";
import { JobQueue } from "../src/downloads/job-queue";

const CONTAINER = "snagbox-job-queue-e2e";
const PORT = 16379;
const REDIS_URL = `redis://127.0.0.1:${PORT}`;

function config(): AppConfigService {
  return { redisUrl: REDIS_URL, maxConcurrentJobs: 2 } as AppConfigService;
}

function docker(args: string[]): void {
  execFileSync("docker", args, { stdio: "pipe" });
}

function startRedis(): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      docker(["rm", "-f", CONTAINER]);
    } catch {
      // The container is absent on a clean machine.
    }
    try {
      docker(["run", "-d", "--name", CONTAINER, "-p", `${PORT}:6379`, "redis:7-alpine"]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not start Redis");
}

async function waitForRedis(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      const pong = await client.ping();
      await client.quit();
      if (pong === "PONG") return;
    } catch (error) {
      lastError = error;
      client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Redis did not become ready");
}

async function waitUntilDone(status: Map<string, string>, jobId: string, inspect: Queue): Promise<void> {
  const deadline = Date.now() + 15_000;
  let state = "missing";
  while (Date.now() < deadline) {
    const job = await inspect.getJob(jobId);
    state = job ? await job.getState() : "missing";
    if (status.get(jobId) === "DONE" && state === "completed") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${jobId} stayed ${status.get(jobId) ?? "unset"} in Redis state ${state}`);
}

describe("JobQueue Redis (docker)", () => {
  beforeAll(async () => {
    startRedis();
    await waitForRedis();
  }, 120_000);

  afterAll(() => {
    try {
      docker(["rm", "-f", CONTAINER]);
    } catch {
      // Best-effort cleanup when docker is already gone.
    }
  });

  async function runUntilDone(order: "handler-first" | "queue-first", jobId: string): Promise<void> {
    const queue = new JobQueue(config());
    const inspect = new Queue("downloads", {
      connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    });
    const status = new Map<string, string>();
    const handler = async (id: string) => {
      status.set(id, "DONE");
    };
    try {
      if (order === "handler-first") {
        queue.setHandler(handler);
        await queue.onModuleInit();
      } else {
        await queue.onModuleInit();
        queue.setHandler(handler);
      }
      queue.setHandler(handler);
      await queue.onModuleInit();
      await queue.enqueue(jobId);
      await waitUntilDone(status, jobId, inspect);
      expect(status.get(jobId)).toBe("DONE");
    } finally {
      await queue.onModuleDestroy();
      await inspect.close();
    }
  }

  it("reaches DONE when the handler is registered before the queue", async () => {
    await runUntilDone("handler-first", "handler-first");
  }, 30_000);

  it("reaches DONE when the queue is ready before the handler", async () => {
    await runUntilDone("queue-first", "queue-first");
  }, 30_000);
});
