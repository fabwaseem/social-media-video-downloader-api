import { Module } from "@nestjs/common";
import { DownloadsController } from "./downloads.controller";
import { DownloadsService } from "./downloads.service";
import { JobEventsService } from "./job-events.service";
import { JobQueue } from "./job-queue";
import { JobRunner } from "./job-runner";

@Module({
  controllers: [DownloadsController],
  providers: [DownloadsService, JobQueue, JobEventsService, JobRunner],
  exports: [DownloadsService],
})
export class DownloadsModule {}
