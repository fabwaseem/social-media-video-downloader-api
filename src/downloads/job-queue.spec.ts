import { Queue, Worker } from "bullmq";
import type { AppConfigService } from "../config/app-config.service";
import { JobQueue } from "./job-queue";

jest.mock("ioredis", () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue("PONG"),
    quit: jest.fn().mockResolvedValue("OK"),
  })),
);

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const WorkerMock = Worker as unknown as jest.Mock;
const QueueMock = Queue as unknown as jest.Mock;

function config(redisUrl: string): AppConfigService {
  return { redisUrl, maxConcurrentJobs: 2 } as AppConfigService;
}

describe("JobQueue worker startup", () => {
  beforeEach(() => {
    WorkerMock.mockClear();
    QueueMock.mockClear();
  });

  it("starts one worker when the handler is set before the queue", async () => {
    const queue = new JobQueue(config("redis://127.0.0.1:6379"));
    queue.setHandler(async () => undefined);
    queue.setHandler(async () => undefined);
    expect(WorkerMock).not.toHaveBeenCalled();

    await queue.onModuleInit();
    await queue.onModuleInit();

    expect(QueueMock).toHaveBeenCalledTimes(1);
    expect(WorkerMock).toHaveBeenCalledTimes(1);
    expect(WorkerMock).toHaveBeenCalledWith(
      "downloads",
      expect.any(Function),
      expect.objectContaining({
        connection: { url: "redis://127.0.0.1:6379", maxRetriesPerRequest: null },
        concurrency: 2,
      }),
    );
    await queue.onModuleDestroy();
  });

  it("starts one worker when the queue is ready before the handler", async () => {
    const queue = new JobQueue(config("redis://127.0.0.1:6379"));
    await queue.onModuleInit();
    await queue.onModuleInit();
    expect(WorkerMock).not.toHaveBeenCalled();
    expect(QueueMock).toHaveBeenCalledTimes(1);

    queue.setHandler(async () => undefined);
    queue.setHandler(async () => undefined);

    expect(WorkerMock).toHaveBeenCalledTimes(1);
    await queue.onModuleDestroy();
  });

  it("does not start a Redis worker when REDIS_URL is unset", async () => {
    const queue = new JobQueue(config(""));
    queue.setHandler(async () => undefined);
    await queue.onModuleInit();
    expect(QueueMock).not.toHaveBeenCalled();
    expect(WorkerMock).not.toHaveBeenCalled();
    await queue.onModuleDestroy();
  });
});
