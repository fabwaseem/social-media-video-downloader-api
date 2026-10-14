import { Controller, Get, Headers, HttpStatus, Param, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { FilesService } from "./files.service";

@ApiTags("Files")
@Controller({ path: "files", version: "2" })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Public()
  @SkipThrottle()
  @Get(":jobId/metadata")
  @ApiOperation({ summary: "Metadata for a finished download" })
  @ApiParam({ name: "jobId" })
  @ApiQuery({ name: "exp" })
  @ApiQuery({ name: "sig" })
  metadata(
    @Param("jobId") jobId: string,
    @Query("exp") exp?: string,
    @Query("sig") sig?: string,
  ) {
    return this.files.getMetadata(jobId, exp, sig);
  }

  @Public()
  @SkipThrottle()
  @Get(":jobId")
  @ApiOperation({
    summary: "Stream a finished download (signed per-job link, supports HTTP range)",
  })
  @ApiParam({ name: "jobId" })
  @ApiQuery({ name: "exp" })
  @ApiQuery({ name: "sig" })
  @ApiProduces("application/octet-stream")
  @ApiResponse({ status: 200, description: "Full file" })
  @ApiResponse({ status: 302, description: "Redirect to a presigned storage URL" })
  @ApiResponse({ status: 206, description: "Partial content" })
  @ApiResponse({ status: 401, description: "Missing or invalid signature" })
  @ApiResponse({ status: 404, description: "File not found or expired" })
  async download(
    @Param("jobId") jobId: string,
    @Query("exp") exp: string | undefined,
    @Query("sig") sig: string | undefined,
    @Headers("range") range: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.files.stream(jobId, exp, sig, range);
    if (result.kind === "redirect") {
      // 302, not 301: the URL is time-limited, so it must never be cached as
      // the permanent location of this file.
      res.redirect(HttpStatus.FOUND, result.url);
      return;
    }
    res.status(result.status).set(result.headers);
    result.stream.pipe(res);
  }
}
