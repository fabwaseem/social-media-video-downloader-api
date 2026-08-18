import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AUTH, type Auth } from "./auth.instance";

// ESM-only module loaded dynamically from CommonJS.
const nodeHelpers = import("better-auth/node");

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Resolves the Better Auth session (if any) from an incoming request. */
@Injectable()
export class AuthSessionService {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  /**
   * Returns the signed-in user or null. Cheap on the hot path: the session
   * cookie cache answers from the signed cookie without touching the DB for
   * five minutes at a time.
   */
  async getUser(req: Request): Promise<SessionUser | null> {
    try {
      const { fromNodeHeaders } = await nodeHelpers;
      const session = await this.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session?.user) return null;
      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      };
    } catch {
      // An unreadable/expired session is anonymous, never an error.
      return null;
    }
  }
}
