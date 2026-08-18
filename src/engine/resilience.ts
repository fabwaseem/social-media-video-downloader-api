import type { Platform } from "@vidyoza/shared";

/**
 * Recovery strategy for flaky extractions.
 *
 * Every platform here A/B-serves more than one page shell, and yt-dlp's
 * extractors are written against one of them. When the other shell comes back
 * the extractor reports "Cannot parse data" — a failure that has nothing to do
 * with the media and clears on a second request seconds later. Retrying the
 * exact same call already fixes most of it; varying the request (desktop
 * user-agent, alternate URL form, alternate API host) fixes the rest.
 */

/**
 * A real desktop Chrome UA. Facebook and TikTok both branch their page shell on
 * it, and the shell they serve to a recognized desktop browser is the one the
 * extractors target.
 */
export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Failures that describe the media rather than the attempt. Retrying these
 * only delays the answer and buries the real reason under a generic timeout,
 * so they end the ladder immediately.
 */
const PERMANENT_PATTERNS: RegExp[] = [
  /unsupported url/i,
  /video unavailable/i,
  /this video is private/i,
  /private video/i,
  /has been removed/i,
  /account (is private|does not exist)/i,
  /age[- ]restricted/i,
  /sign in to confirm your age/i,
  // yt-dlp phrases this several ways: "not available in your country", "has
  // not made this video available in your country", "not available from your
  // location due to geo restriction".
  /geo[- ]restrict/i,
  /not (made this video )?available (in|from) your (country|location)/i,
  /blocked (it )?in your country/i,
  /requested format is not available/i,
  /live event will begin/i,
  /is currently live/i,
  /removed for violating/i,
  /copyright (grounds|claim)/i,
  /no space left on device/i,
];

/**
 * Failures known to clear on retry. Listed explicitly so the intent is
 * reviewable, even though unknown errors are retried too — see `isRetryable`.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /cannot parse data/i,
  /unable to extract/i,
  /unable to download (webpage|json|api|video data)/i,
  /failed to parse json/i,
  /expecting value/i,
  /timed? ?out/i,
  /read timed out/i,
  /connection (reset|refused|aborted|closed)/i,
  /remote end closed connection/i,
  /temporary failure in name resolution/i,
  /getaddrinfo/i,
  /http error 5\d\d/i,
  /http error 429/i,
  /rate[- ]?limit/i,
  /incomplete read/i,
  /content too short/i,
  /giving up after/i,
  /empty response/i,
  /no video formats found/i,
  /ssl/i,
];

/**
 * Whether another attempt is worth making.
 *
 * Unknown errors count as retryable. Extractors break in new ways every week,
 * and a bounded extra attempt costs a couple of seconds while a wrongly
 * permanent classification costs the user their download — the asymmetry
 * decides it. `PERMANENT_PATTERNS` is the authority on what to give up on.
 */
export function isRetryable(message: string): boolean {
  if (!message) return true;
  if (PERMANENT_PATTERNS.some((re) => re.test(message))) return false;
  return true;
}

/** True when the message is one we have explicitly seen recover. Logging only. */
export function isKnownTransient(message: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** One rung of the ladder: which URL to ask for, and with what extra args. */
export interface Attempt {
  /** URL handed to yt-dlp — some platforms parse an alternate form more reliably. */
  url: string;
  /** Args appended after the base set, for this attempt only. */
  args: string[];
  /** Short description, used in logs. */
  label: string;
}

/**
 * Rewrites any Facebook video URL to the canonical `/watch/?v=<id>` form.
 *
 * The reel and share shells are the ones that flake; `/watch/` is served by an
 * older, stabler path. The numeric id is the same across all of them, so the
 * last long run of digits in the path (or the `v` query param) identifies it
 * regardless of which form the user pasted.
 */
export function facebookWatchUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const v = parsed.searchParams.get("v");
    if (v && /^\d{6,}$/.test(v)) return `https://www.facebook.com/watch/?v=${v}`;

    const id = parsed.pathname
      .split("/")
      .filter(Boolean)
      .reverse()
      .find((segment) => /^\d{6,}$/.test(segment));
    return id ? `https://www.facebook.com/watch/?v=${id}` : null;
  } catch {
    return null;
  }
}

/**
 * The ladder for a URL, always exactly `maxAttempts` long.
 *
 * Rung 1 is always the untouched request: the overwhelming majority of calls
 * succeed there and must not pay for the fallbacks. Later rungs vary one thing
 * at a time so a recovery in the log says which variation mattered. When the
 * ladder is shorter than the budget the last rung repeats — a plain second try
 * is itself the single most effective fix for shell flapping.
 */
export function buildAttempts(
  url: string,
  platform: Platform | null,
  maxAttempts: number,
): Attempt[] {
  const rungs = ladder(url, platform);
  const total = Math.max(1, maxAttempts);
  return Array.from({ length: total }, (_, i) => rungs[Math.min(i, rungs.length - 1)]);
}

function ladder(url: string, platform: Platform | null): Attempt[] {
  const plain: Attempt = { url, args: [], label: "default" };
  const desktop: Attempt = { url, args: ["--user-agent", DESKTOP_UA], label: "desktop UA" };

  switch (platform) {
    case "facebook": {
      const watch = facebookWatchUrl(url);
      const rungs = [plain, desktop];
      if (watch && watch !== url) {
        rungs.push({ url: watch, args: ["--user-agent", DESKTOP_UA], label: "watch URL form" });
      }
      return rungs;
    }

    case "tiktok":
      return [
        plain,
        desktop,
        {
          url,
          // TikTok's webapp API shards by region and individual hosts return
          // truncated payloads under load; this one is the documented escape
          // hatch for exactly that.
          args: [
            "--user-agent",
            DESKTOP_UA,
            "--extractor-args",
            "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com",
          ],
          label: "alternate API host",
        },
      ];

    case "youtube":
      return [
        plain,
        {
          url,
          // The base args already list the clients that dodge YouTube's
          // proof-of-origin check, so a retry has to reach for a genuinely
          // different set rather than a weaker one — leading with the clients
          // that never depend on a web session, and adding the ones that
          // sometimes carry formats the others lack.
          args: [
            "--extractor-args",
            "youtube:player_client=tv_embedded,android_vr,android,ios,mweb,web_embedded",
          ],
          label: "non-web player clients",
        },
        desktop,
      ];

    default:
      return [plain, desktop];
  }
}

/** Exponential backoff with jitter, so retries do not re-collide. */
export function retryDelayMs(attemptIndex: number, baseMs: number): number {
  const backoff = baseMs * 2 ** attemptIndex;
  return Math.round(backoff + Math.random() * baseMs);
}

/**
 * Backoff delay. Deliberately *not* unref'd: this timer is the pending work,
 * so letting the event loop drain through it would strand the retry and leave
 * the caller's promise unsettled forever.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The most informative text an execFile/spawn rejection carries.
 *
 * Node folds stderr into `.message` for execFile, but truncates it; the
 * `stderr` property holds the full text and that is where yt-dlp's ERROR line
 * lives.
 */
export function rawErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Single-line form of a multi-line yt-dlp error, for log lines. */
export function briefError(message: string): string {
  const errLine = message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => l.startsWith("ERROR:"));
  return (errLine ?? message.split("\n")[0] ?? message).slice(0, 300);
}
