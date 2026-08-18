import { basename, join, normalize, resolve, sep } from "path";

/** Strips characters that are unsafe in filenames across platforms. */
export function sanitizeFilename(name: string, maxLength = 120): string {
  let cleaned = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop control characters and reserved filesystem characters.
    if (code < 0x20 || code === 0x7f) continue;
    if ('\\/:*?"<>|'.includes(ch)) continue;
    cleaned += ch;
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
  // Windows disallows trailing dots.
  cleaned = cleaned.replace(/\.+$/, "");
  return cleaned || "download";
}

/**
 * Resolves `filename` inside `baseDir`, rejecting any path traversal attempt.
 * Returns the absolute path or null when the input escapes the base directory.
 */
export function safeJoin(baseDir: string, filename: string): string | null {
  // Only accept bare filenames — no directories at all.
  if (filename !== basename(filename)) return null;
  if (filename.includes("..")) return null;
  const base = resolve(baseDir);
  const target = normalize(join(base, filename));
  if (target !== base && !target.startsWith(base + sep)) return null;
  if (target === base) return null;
  return target;
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** RFC 5987 encoded Content-Disposition for non-ASCII filenames. */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) =>
    c === "'" ? "%27" : c === "(" ? "%28" : "%29",
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
