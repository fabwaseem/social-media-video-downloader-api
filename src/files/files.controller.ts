import { Controller, Get, Headers, HttpStatus, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { FilesService } from "./files.service";

@ApiTags("Files")
@Controller({ path: "files", version: "2" })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @SkipThrottle()
  @Get(":filename")
  @ApiOperation({ summary: "Stream a finished download (supports HTTP range)" })
  @ApiParam({ name: "filename" })
  @ApiProduces("application/octet-stream")
  @ApiResponse({ status: 200, description: "Full file" })
  @ApiResponse({ status: 302, description: "Redirect to a presigned storage URL" })
  @ApiResponse({ status: 206, description: "Partial content" })
  @ApiResponse({ status: 404, description: "File not found or expired" })
  async download(
    @Param("filename") filename: string,
    @Headers("range") range: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.files.stream(filename, range);
    if (result.kind === "redirect") {
      // 302, not 301: the URL is time-limited, so it must never be cached as
      // the permanent location of this file.
      res.redirect(HttpStatus.FOUND, result.url);
      return;
    }
    res.status(result.status).set(result.headers);
    result.stream.pipe(res);
  }

  @Get(":filename/metadata")
  @ApiOperation({ summary: "Metadata for a finished download" })
  @ApiParam({ name: "filename" })
  metadata(@Param("filename") filename: string) {
    return this.files.getMetadata(filename);
  }
}
