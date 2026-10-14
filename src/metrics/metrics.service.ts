import { Injectable } from "@nestjs/common";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly httpRequests: Counter<"method" | "status">;
  private readonly jobs: Counter<"status" | "platform">;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({
      name: "http_requests_total",
      help: "HTTP responses by method and status",
      labelNames: ["method", "status"],
      registers: [this.registry],
    });
    this.jobs = new Counter({
      name: "download_jobs_total",
      help: "Download jobs by outcome and platform",
      labelNames: ["status", "platform"],
      registers: [this.registry],
    });
  }

  recordHttp(method: string, status: string): void {
    this.httpRequests.inc({ method, status });
  }

  recordJob(status: string, platform: string): void {
    this.jobs.inc({ status, platform });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
