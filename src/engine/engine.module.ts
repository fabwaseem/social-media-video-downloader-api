import { Global, Module } from "@nestjs/common";
import { BinariesService } from "./binaries.service";
import { DirectDownloadService } from "./direct-download.service";
import { ExtractionService } from "./extraction.service";
import { TikTokEmbedProvider } from "./providers/tiktok-embed.provider";
import { YtdlpService } from "./ytdlp.service";

@Global()
@Module({
  providers: [
    BinariesService,
    YtdlpService,
    DirectDownloadService,
    TikTokEmbedProvider,
    ExtractionService,
  ],
  exports: [BinariesService, YtdlpService, ExtractionService],
})
export class EngineModule {}
