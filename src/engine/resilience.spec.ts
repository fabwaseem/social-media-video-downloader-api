import {
  briefError,
  buildAttempts,
  facebookWatchUrl,
  isKnownTransient,
  isRetryable,
  rawErrorText,
  retryDelayMs,
} from "./resilience";

describe("retry classification", () => {
  it("treats media problems as permanent and flakes as retryable", () => {
    expect(isRetryable("ERROR: Private video")).toBe(false);
    expect(isRetryable("Video unavailable")).toBe(false);
    expect(isRetryable("This video is not available in your country")).toBe(false);
    expect(isRetryable("ERROR: Cannot parse data")).toBe(true);
    expect(isRetryable("HTTP Error 429: Too Many Requests")).toBe(true);
    expect(isRetryable("")).toBe(true);
    expect(isRetryable("something the extractor has never said")).toBe(true);
    expect(isKnownTransient("Unable to extract webpage")).toBe(true);
    expect(isKnownTransient("Private video")).toBe(false);
  });

  it("prefers stderr and keeps the ERROR line short", () => {
    const error = Object.assign(new Error("short"), {
      stderr: "WARNING: ignored\nERROR: Cannot parse data for this page",
    });
    expect(rawErrorText(error)).toContain("Cannot parse data");
    expect(briefError(rawErrorText(error))).toBe("ERROR: Cannot parse data for this page");
  });
});

describe("attempt ladder", () => {
  it("stays the requested length and varies one thing at a time", () => {
    const youtube = buildAttempts("https://www.youtube.com/watch?v=abc", "youtube", 2);
    expect(youtube).toHaveLength(2);
    expect(youtube[0]).toMatchObject({ label: "default", args: [] });
    expect(youtube[1].label).toBe("non-web player clients");
    expect(youtube[1].args.join(" ")).toContain("player_client=");

    const tiktok = buildAttempts("https://www.tiktok.com/@u/video/123456789", "tiktok", 3);
    expect(tiktok.map((step) => step.label)).toEqual([
      "default",
      "desktop UA",
      "alternate API host",
    ]);
    expect(tiktok[2].args).toEqual([
      "--user-agent",
      expect.any(String),
      "--extractor-args",
      expect.stringContaining("api_hostname="),
    ]);
  });

  it("rewrites facebook reel URLs to the watch form on a later rung", () => {
    const source = "https://www.facebook.com/reel/123456789012345";
    expect(facebookWatchUrl(source)).toBe("https://www.facebook.com/watch/?v=123456789012345");
    const attempts = buildAttempts(source, "facebook", 4);
    expect(attempts).toHaveLength(4);
    expect(attempts[2].url).toBe("https://www.facebook.com/watch/?v=123456789012345");
    expect(attempts[3]).toEqual(attempts[2]);
  });

  it("backs off without exceeding a small multiple of the base", () => {
    const delay = retryDelayMs(2, 800);
    expect(delay).toBeGreaterThanOrEqual(800 * 4);
    expect(delay).toBeLessThanOrEqual(800 * 4 + 800);
  });
});
