import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminController } from "./admin.controller";
import { ApiKeyService } from "./api-key.service";
import { AuthSessionService } from "./auth-session.service";
import { AUTH, createAuth } from "./auth.instance";

@Global()
@Module({
  controllers: [AdminController],
  providers: [
    ApiKeyService,
    AuthSessionService,
    {
      provide: AUTH,
      useFactory: (prisma: PrismaService, config: AppConfigService) =>
        createAuth(prisma, config),
      inject: [PrismaService, AppConfigService],
    },
  ],
  exports: [ApiKeyService, AuthSessionService, AUTH],
})
export class AuthModule {}
