import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { contentDisposition, contentTypeFor, safeJoin, sanitizeFilename } from "./filename";

describe("sanitizeFilename", () => {
  it("drops path separators, control characters, and reserved names", () => {
    expect(sanitizeFilename('a/b\\c:d*e?"f<g>h|i')).toBe("abcdefghi");
    expect(sanitizeFilename("hello\u0000world")).toBe("helloworld");
    expect(sanitizeFilename("   ")).toBe("download");
    expect(sanitizeFilename("report.")).toBe("report");
    expect(sanitizeFilename("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("safeJoin", () => {
  const base = mkdtempSync(join(tmpdir(), "files-"));

  it("accepts a bare filename and rejects traversal", () => {
    expect(safeJoin(base, "video.mp4")).toBe(join(base, "video.mp4"));
    expect(safeJoin(base, "../secret.txt")).toBeNull();
    expect(safeJoin(base, "nested/video.mp4")).toBeNull();
    expect(safeJoin(base, "..")).toBeNull();
    expect(safeJoin(base, ".")).toBeNull();
    expect(safeJoin(base, "video.mp4\0.txt")).toBeNull();
  });
});

describe("content headers", () => {
  it("maps known extensions and encodes a download name", () => {
    expect(contentTypeFor("clip.mp4")).toBe("video/mp4");
    expect(contentTypeFor("song.MP3")).toBe("audio/mpeg");
    expect(contentTypeFor("nope.bin")).toBe("application/octet-stream");
    const header = contentDisposition('Rick "Astley" — song.mp4');
    expect(header).toContain("attachment;");
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain("\u2014");
  });
});
