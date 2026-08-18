import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ApiError } from "@vidyoza/shared";
import type { Request, Response } from "express";
import { ApiException } from "../errors";

/**
 * Converts every uncaught error into a consistent JSON envelope and keeps
 * internals out of production responses.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // SSE/streaming responses that already started cannot receive a JSON body.
    if (response.headersSent) {
      response.end();
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b.message)
          ? (b.message as string[]).join("; ")
          : ((b.message as string) ?? exception.message);
        details = b.details ?? (Array.isArray(b.message) ? b.message : undefined);
      }
      if (exception instanceof ApiException) {
        code = exception.code;
      }
    } else if (exception instanceof Error) {
      message =
        process.env.NODE_ENV === "production" ? "Internal server error" : exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${message}`);
    }

    const payload: ApiError = {
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message,
      code,
      requestId: (request as Request & { requestId?: string }).requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
      details,
    };

    response.status(status).json(payload);
  }
}
