import { HttpException, HttpStatus } from "@nestjs/common";

/** Machine-readable error codes surfaced to clients. */
export enum ErrorCode {
  INVALID_URL = "INVALID_URL",
  UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM",
  DURATION_LIMIT_EXCEEDED = "DURATION_LIMIT_EXCEEDED",
  LIVE_STREAM_UNSUPPORTED = "LIVE_STREAM_UNSUPPORTED",
  JOB_NOT_FOUND = "JOB_NOT_FOUND",
  JOB_NOT_CANCELLABLE = "JOB_NOT_CANCELLABLE",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_EXPIRED = "FILE_EXPIRED",
  EXTRACTION_FAILED = "EXTRACTION_FAILED",
  QUEUE_FULL = "QUEUE_FULL",
  INVALID_API_KEY = "INVALID_API_KEY",
  RATE_LIMITED = "RATE_LIMITED",
}

/** HttpException carrying a stable error code alongside the message. */
export class ApiException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ message, code, details }, status);
  }
}
