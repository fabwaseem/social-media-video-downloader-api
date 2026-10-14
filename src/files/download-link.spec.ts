import { fileLinkPath, signFileLink, verifyFileLink } from "./download-link";

const secret = "test-file-secret";
const jobId = "550e8400-e29b-41d4-a716-446655440000";

describe("file download links", () => {
  it("builds a per-job path that does not contain the filename", () => {
    const path = fileLinkPath(jobId, secret, 60, 1_700_000_000_000);
    expect(path.startsWith(`/v2/files/${jobId}?`)).toBe(true);
    expect(path).not.toContain(".mp4");
    expect(path).toContain("exp=");
    expect(path).toContain("sig=");
  });

  it("accepts a fresh signature and rejects tampering or expiry", () => {
    const now = 1_700_000_000_000;
    const exp = Math.floor(now / 1000) + 60;
    const sig = signFileLink(jobId, exp, secret);
    expect(verifyFileLink(jobId, String(exp), sig, secret, now)).toBe(true);
    expect(verifyFileLink(jobId, String(exp), sig, "other-secret", now)).toBe(false);
    expect(verifyFileLink("other-job", String(exp), sig, secret, now)).toBe(false);
    expect(verifyFileLink(jobId, String(exp - 120), signFileLink(jobId, exp - 120, secret), secret, now)).toBe(
      false,
    );
    expect(verifyFileLink(jobId, "nope", sig, secret, now)).toBe(false);
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifyFileLink(jobId, String(exp), flipped, secret, now)).toBe(false);
  });
});
