import { createHmac, timingSafeEqual } from "crypto";

/**
 * Per-job download links.
 *
 * The path carries the job id, not the filename, and the query signature is an
 * HMAC of that id plus an expiry. Guessing a title or an output name does not
 * produce a working URL.
 */
export function signFileLink(jobId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${jobId}.${exp}`).digest("base64url");
}

export function fileLinkPath(
  jobId: string,
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const sig = signFileLink(jobId, exp, secret);
  return `/v2/files/${encodeURIComponent(jobId)}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

export function verifyFileLink(
  jobId: string,
  expRaw: string | undefined,
  sig: string | undefined,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!expRaw || !sig || !/^\d+$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp < Math.floor(nowMs / 1000)) return false;
  const expected = signFileLink(jobId, exp, secret);
  const left = Buffer.from(expected);
  const right = Buffer.from(sig);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
