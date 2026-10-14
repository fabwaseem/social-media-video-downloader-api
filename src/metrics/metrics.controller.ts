import { Controller, Get, Header, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator";
import { MetricsService } from "./metrics.service";

@Controller({ path: "metrics", version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("Cache-Control", "no-store")
  scrape(): Promise<string> {
    return this.metrics.render();
  }
}
