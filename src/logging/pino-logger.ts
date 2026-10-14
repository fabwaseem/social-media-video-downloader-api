import { LoggerService } from "@nestjs/common";
import pino, { type Logger } from "pino";

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers['x-api-key']",
        "req.headers.cookie",
        "req.headers['x-frontend-key']",
      ],
      remove: true,
    },
  });
}

export const rootLogger = createLogger(process.env.LOG_LEVEL || "info");

function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/** Nest logger that writes one JSON object per line through pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger = rootLogger) {}

  log(message: unknown, ...optional: unknown[]): void {
    const { context } = this.contextOf(optional);
    this.logger.info({ context }, messageText(message));
  }

  error(message: unknown, ...optional: unknown[]): void {
    const { context, trace } = this.contextOf(optional);
    this.logger.error({ context, trace }, messageText(message));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    const { context } = this.contextOf(optional);
    this.logger.warn({ context }, messageText(message));
  }

  debug(message: unknown, ...optional: unknown[]): void {
    const { context } = this.contextOf(optional);
    this.logger.debug({ context }, messageText(message));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    const { context } = this.contextOf(optional);
    this.logger.trace({ context }, messageText(message));
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    const { context } = this.contextOf(optional);
    this.logger.fatal({ context }, messageText(message));
  }

  private contextOf(optional: unknown[]): { context?: string; trace?: string } {
    const strings = optional.filter((value): value is string => typeof value === "string");
    const trace = strings.find((value) => value.includes("\n"));
    const context = strings.filter((value) => value !== trace).at(-1);
    return { context, trace };
  }
}
