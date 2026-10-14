import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { RedisThrottlerStorage } from "./throttler-storage";

@Global()
@Module({
  providers: [RedisService, RedisThrottlerStorage],
  exports: [RedisService, RedisThrottlerStorage],
})
export class RedisModule {}
