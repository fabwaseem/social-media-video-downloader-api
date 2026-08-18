import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Sse,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { JobEvent } from "@vidyoza/shared";
import { Observable, endWith, ignoreElements, interval, map, merge, takeUntil } from "rxjs";
import type { AuthedRequest } from "../auth/api-key.guard";
import { AuthSessionService } from "../auth/auth-session.service";
import { DownloadsService } from "./downloads.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { CreateDownloadDto } from "./dto/create-download.dto";

interface SseMessage {
  data: string;
}

@ApiTags("Downloads")
@Controller({ path: "downloads", version: "2" })
export class DownloadsController {
  constructor(
    private readonly downloads: DownloadsService,
    private readonly sessions: AuthSessionService,
  ) {}

  @Post()
  @ApiSecurity("api-key")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Create a download job (video or audio)" })
  @ApiResponse({ status: 202, description: "Job accepted and queued" })
  @ApiResponse({ status: 400, description: "Invalid URL or options" })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async create(@Body() dto: CreateDownloadDto, @Req() req: AuthedRequest) {
    const user = await this.sessions.getUser(req);
    return this.downloads.create(dto, { apiKey: req.apiKey, user });
  }

  @Post("batch")
  @ApiSecurity("api-key")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @ApiOperation({
    summary: "Queue one job per URL (playlist or channel selection)",
    description:
      "Returns the created jobs in request order. Track each through its own /events stream.",
  })
  @ApiResponse({ status: 202, description: "Jobs accepted and queued" })
  @ApiResponse({ status: 503, description: "Not enough queue capacity" })
  async createBatch(@Body() dto: CreateBatchDto, @Req() req: AuthedRequest) {
    const user = await this.sessions.getUser(req);
    return this.downloads.createBatch(dto, { apiKey: req.apiKey, user });
  }

  @Get()
  @ApiOperation({
    summary: "Get many jobs at once",
    description:
      "Comma-separated ids. Batch downloads poll this instead of opening one SSE stream per job — browsers cap concurrent connections per host, so a 50-item batch would stall on its own event streams.",
  })
  @ApiQuery({ name: "ids", required: true, description: "Comma-separated job ids (max 100)" })
  getMany(@Query("ids") ids: string) {
    return this.downloads.getMany((ids ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a download job by id" })
  @ApiParam({ name: "id", format: "uuid" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.downloads.get(id);
  }

  @Sse(":id/events")
  @ApiOperation({
    summary: "Live job events (SSE)",
    description:
      "Server-Sent Events stream: status, progress, complete and error events serialized as JSON.",
  })
  events(@Param("id", ParseUUIDPipe) id: string): Observable<SseMessage> {
    const events$ = this.downloads
      .events$(id)
      .pipe(map((event: JobEvent): SseMessage => ({ data: JSON.stringify(event) })));
    // Heartbeat keeps the stream alive through proxies that reap idle
    // connections (the Next.js rewrite proxy among them). Clients ignore it.
    const done$ = events$.pipe(ignoreElements(), endWith(null));
    const heartbeat$ = interval(15_000).pipe(
      map((): SseMessage => ({ data: '{"type":"ping"}' })),
      takeUntil(done$),
    );
    return merge(events$, heartbeat$);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Cancel a queued or running download" })
  @ApiResponse({ status: 200, description: "Job cancelled" })
  @ApiResponse({ status: 409, description: "Job already finished" })
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.downloads.cancel(id);
  }
}
