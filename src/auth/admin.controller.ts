import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { AdminGuard } from "./admin.guard";
import { ApiKeyService } from "./api-key.service";
import { BlockKeyDto, CreateKeyDto } from "./dto/create-key.dto";

// @Public defers the global access guard; AdminGuard enforces the admin token.
@ApiTags("Admin")
@ApiSecurity("admin-token")
@Public()
@UseGuards(AdminGuard)
@Controller({ path: "admin", version: "2" })
export class AdminController {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("keys")
  @ApiOperation({ summary: "Create an API key (secret returned once)" })
  createKey(@Body() dto: CreateKeyDto) {
    return this.apiKeys.createKey(dto);
  }

  @Get("keys")
  @ApiOperation({ summary: "List API keys (secrets masked)" })
  listKeys() {
    return this.apiKeys.listKeys();
  }

  @Post("keys/:id/block")
  @ApiOperation({ summary: "Block an API key" })
  blockKey(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BlockKeyDto) {
    return this.apiKeys.blockKey(id, dto.reason);
  }

  @Delete("keys/:id")
  @ApiOperation({ summary: "Delete an API key" })
  deleteKey(@Param("id", ParseUUIDPipe) id: string) {
    return this.apiKeys.deleteKey(id);
  }

  @Get("downloads")
  @ApiOperation({ summary: "Download history (most recent first)" })
  async listDownloads(@Query("take") take?: string) {
    const limit = Math.min(Math.max(parseInt(take ?? "50", 10) || 50, 1), 200);
    const rows = await this.prisma.download.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ ...r, fileSizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null }));
  }

  @Get("stats")
  @ApiOperation({ summary: "Aggregate usage stats" })
  async stats() {
    const [total, completed, failed, byPlatform] = await Promise.all([
      this.prisma.download.count(),
      this.prisma.download.count({ where: { status: "COMPLETED" } }),
      this.prisma.download.count({ where: { status: "FAILED" } }),
      this.prisma.download.groupBy({ by: ["platform"], _count: { _all: true } }),
    ]);
    return {
      total,
      completed,
      failed,
      byPlatform: Object.fromEntries(byPlatform.map((p) => [p.platform, p._count._all])),
    };
  }
}
