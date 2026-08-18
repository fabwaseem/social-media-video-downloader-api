import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import type { Request } from "express";
import { AppConfigService } from "../config/app-config.service";

/** Protects /v2/admin routes with a constant-time token comparison. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.adminToken;
    if (!token) {
      throw new ForbiddenException("Admin API is disabled (no ADMIN_TOKEN configured)");
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided =
      request.header("x-admin-token") ??
      request.header("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";

    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid admin token");
    }
    return true;
  }
}
