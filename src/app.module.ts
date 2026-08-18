import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ApiKeyGuard } from "./auth/api-key.guard";
import { AuthModule } from "./auth/auth.module";
import { CleanupModule } from "./cleanup/cleanup.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { AppConfigModule } from "./config/config.module";
import { AppConfigService } from "./config/app-config.service";
import { DownloadsModule } from "./downloads/downloads.module";
import { EngineModule } from "./engine/engine.module";
import { StorageModule } from "./storage/storage.module";
import { FilesModule } from "./files/files.module";
import { HealthModule } from "./health/health.module";
import { MediaModule } from "./media/media.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    EngineModule,
    StorageModule,
    AuthModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            ttl: config.throttleTtlSeconds * 1000,
            limit: config.throttleLimit,
          },
        ],
      }),
    }),
    HealthModule,
    MediaModule,
    DownloadsModule,
    FilesModule,
    CleanupModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes("*");
  }
}
