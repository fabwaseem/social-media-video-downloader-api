import { HttpStatus } from "@nestjs/common";
import { ErrorCode } from "../../common/errors";

export interface ClassifiedFailure {
  code: ErrorCode;
  message: string;
  status: number;
}

/** Failure from the download engine, already mapped to a stable code. */
export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(failure: ClassifiedFailure) {
    super(failure.message);
    this.name = "EngineError";
    this.code = failure.code;
    this.status = failure.status;
  }
}

function textOf(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/**
 * Maps yt-dlp stderr (or an already-friendly message) onto a stable code.
 * Order matters: the bot-check text contains "sign in", and the age gate
 * contains both "sign in" and "confirm".
 */
export function classifyYtdlpFailure(error: unknown): ClassifiedFailure {
  if (error instanceof EngineError) {
    return { code: error.code, message: error.message, status: error.status };
  }

  const raw = textOf(error);
  const lower = raw.toLowerCase();

  const failure = (code: ErrorCode, message: string, status: number): ClassifiedFailure => ({
    code,
    message,
    status,
  });

  if (lower.includes("n challenge") || lower.includes("no supported javascript runtime")) {
    return failure(
      ErrorCode.EXTRACTION_FAILED,
      "The download engine is missing a JavaScript runtime, so the platform withheld every playable format. Install deno (or run the API on Node 22+) — see YTDLP_JS_RUNTIME.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  if (lower.includes("not a bot") || lower.includes("sign in to confirm")) {
    return failure(
      ErrorCode.BLOCKED,
      "YouTube is asking this server to sign in before it will serve this video. It applies that check to some videos only, and server IP ranges fail it where a home connection passes — so it is not something retrying fixes. The server needs logged-in cookies (COOKIES_FILE / COOKIES_B64), a proof-of-origin token provider, or a residential proxy (YTDLP_PROXY).",
      HttpStatus.FORBIDDEN,
    );
  }
  if (lower.includes("unsupported url") || lower.includes("unsupported url:")) {
    return failure(ErrorCode.UNSUPPORTED, "This URL is not supported.", HttpStatus.BAD_REQUEST);
  }
  if (lower.includes("private video") || lower.includes("this video is private") || lower.includes("members-only") || lower.includes("members only")) {
    return failure(ErrorCode.PRIVATE, "This video is private.", HttpStatus.FORBIDDEN);
  }
  if (lower.includes("sign in to confirm your age") || lower.includes("age-restricted") || lower.includes("age restricted")) {
    return failure(
      ErrorCode.LOGIN_REQUIRED,
      "This video is age-restricted and cannot be downloaded.",
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (lower.includes("login required") || lower.includes("logged in") || lower.includes("sign in to view")) {
    return failure(
      ErrorCode.LOGIN_REQUIRED,
      "The platform requires a login before this media can be downloaded.",
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (
    lower.includes("video unavailable") ||
    lower.includes("has been removed") ||
    lower.includes("this video is unavailable") ||
    /\bnot found\b/.test(lower)
  ) {
    return failure(
      ErrorCode.UNAVAILABLE,
      "This video is unavailable or has been removed.",
      HttpStatus.NOT_FOUND,
    );
  }
  if (lower.includes("requested format is not available")) {
    return failure(
      ErrorCode.EXTRACTION_FAILED,
      "The requested quality/format is not available for this media.",
      HttpStatus.BAD_REQUEST,
    );
  }
  if (/geo[- ]restrict|not (made this video )?available (in|from) your (country|location)/.test(lower)) {
    return failure(ErrorCode.GEO_RESTRICTED, "This media is geo-restricted.", 451);
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return failure(
      ErrorCode.EXTRACTION_FAILED,
      "The request to the platform timed out. Please try again.",
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
  if (lower.includes("rate-limit") || lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return failure(
      ErrorCode.BLOCKED,
      "The platform is rate-limiting requests right now. Please try again later.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (lower.includes("blocked") || lower.includes("access denied") || lower.includes("forbidden")) {
    return failure(
      ErrorCode.BLOCKED,
      "The platform blocked this download.",
      HttpStatus.FORBIDDEN,
    );
  }
  if (lower.includes("live event") || lower.includes("is live")) {
    return failure(
      ErrorCode.LIVE_STREAM_UNSUPPORTED,
      "Live streams cannot be downloaded until they finish.",
      HttpStatus.BAD_REQUEST,
    );
  }
  if (lower.includes("cannot parse data") || lower.includes("unable to extract")) {
    return failure(
      ErrorCode.EXTRACTION_FAILED,
      "The platform returned a page this downloader could not read. That is usually temporary — please try again in a minute.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  const errLine = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ERROR:"))
    .at(-1);
  if (errLine) {
    const message = errLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "").trim() || "Download failed.";
    return failure(ErrorCode.EXTRACTION_FAILED, message, HttpStatus.BAD_REQUEST);
  }
  return failure(
    ErrorCode.EXTRACTION_FAILED,
    "Download failed. Please check the URL and try again.",
    HttpStatus.BAD_REQUEST,
  );
}

export function friendlyYtdlpError(error: unknown): string {
  return classifyYtdlpFailure(error).message;
}

export function asEngineError(error: unknown): EngineError {
  return new EngineError(classifyYtdlpFailure(error));
}
