import { Global, Module } from "@nestjs/common";
import { StorageQuotaService } from "./storage-quota.service";
import { StorageService } from "./storage.service";

@Global()
@Module({
  providers: [StorageService, StorageQuotaService],
  exports: [StorageService, StorageQuotaService],
})
export class StorageModule {}
