import { Controller, Get, HttpStatus, ParseIntPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CHANNEL_TABS } from "@vidyoza/shared";
import { MediaService } from "./media.service";

@ApiTags("Media")
@Controller({ path: "media", version: "2" })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get("info")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Fetch normalized media info for a supported URL" })
  @ApiQuery({ name: "url", required: true })
  @ApiResponse({ status: HttpStatus.OK, description: "Media info" })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid or unsupported URL" })
  getInfo(@Query("url") url: string) {
    return this.media.getInfo(url);
  }

  @Get("collection")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "List one page of a playlist or channel (flat, no per-video extraction)",
  })
  @ApiQuery({ name: "url", required: true })
  @ApiQuery({ name: "tab", required: false, enum: CHANNEL_TABS, description: "Channels only" })
  @ApiQuery({ name: "offset", required: false, description: "1-based index of the first entry" })
  @ApiQuery({ name: "limit", required: false, description: "Page size (max 100)" })
  getCollection(
    @Query("url") url: string,
    @Query("tab") tab?: string,
    @Query("offset", new ParseIntPipe({ optional: true })) offset?: number,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.media.getCollection({ url, tab, offset, limit });
  }

  @Get("playlist")
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: "Fetch entries of a playlist URL (flat, max 100)" })
  @ApiQuery({ name: "url", required: true })
  getPlaylist(@Query("url") url: string) {
    return this.media.getPlaylist(url);
  }

  @Get("platforms")
  @ApiOperation({ summary: "List supported platforms" })
  getPlatforms() {
    return this.media.getPlatforms();
  }
}
