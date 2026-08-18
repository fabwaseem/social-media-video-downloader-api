import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

/** Attaches a request id (honoring inbound X-Request-Id) for tracing. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
