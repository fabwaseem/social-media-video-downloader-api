import { createHash } from "crypto";

/**
 * Cheap sanity check that a blob is a Netscape cookie jar with real entries.
 * A malformed COOKIES_B64 never becomes the live jar, and a truncated local
 * file never overwrites a good stored one.
 */
export function looksLikeCookieJar(text: string): boolean {
  if (!text || text.length < 32) return false;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  return lines.some((line) => line.split("\t").length >= 7);
}

export function cookieDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
