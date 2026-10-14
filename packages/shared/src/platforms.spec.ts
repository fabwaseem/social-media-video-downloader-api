import {
  detectChannelTab,
  detectPlatform,
  detectUrlKind,
  extractPlaylistId,
  extractVideoUrl,
  isValidHttpUrl,
  normalizeCollectionUrl,
  resolvePlatform,
} from "./platforms";

describe("detectPlatform", () => {
  const cases: Array<[string, string | null]> = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://www.youtube.com/shorts/abcdefghijk", "youtube"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://www.instagram.com/reel/Cxyzabc/", "instagram"],
    ["https://www.tiktok.com/@user/video/1234567890123", "tiktok"],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
    ["https://www.tiktok.com/t/ZTxyz/", "tiktok"],
    ["https://x.com/user/status/1234567890", "twitter"],
    ["https://twitter.com/user/status/1234567890", "twitter"],
    ["https://t.co/abcDEF12", "twitter"],
    ["https://www.facebook.com/watch?v=1234567890", "facebook"],
    ["https://fb.watch/abc123/", "facebook"],
    ["https://www.reddit.com/r/videos/comments/abc123/title/", "reddit"],
    ["https://v.redd.it/abc123", "reddit"],
    ["https://vimeo.com/76979871", "vimeo"],
    ["https://bsky.app/profile/user.bsky.social/post/abc123", "bluesky"],
    ["https://www.threads.net/@user/post/abc123", "threads"],
    ["https://www.pinterest.com/pin/1234567890/", "pinterest"],
    ["https://pin.it/abc123", "pinterest"],
    ["https://clips.twitch.tv/ExampleClipName", "twitch"],
    ["https://www.twitch.tv/channel/clip/ExampleClipName", "twitch"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://www.snapchat.com/spotlight/abc123", "snapchat"],
    ["https://example.com/video", null],
    ["", null],
    ["not a url", null],
  ];

  it.each(cases)("%s -> %s", (url, platform) => {
    expect(detectPlatform(url)).toBe(platform);
  });
});

describe("resolvePlatform", () => {
  it("returns generic only when that mode is on", () => {
    expect(resolvePlatform("https://example.com/video", false)).toBeNull();
    expect(resolvePlatform("https://example.com/video", true)).toBe("generic");
    expect(resolvePlatform("https://vimeo.com/76979871", false)).toBe("vimeo");
  });
});

describe("URL kind and playlist helpers", () => {
  it("classifies watch, playlist, and channel URLs", () => {
    expect(detectUrlKind("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("video");
    expect(detectUrlKind("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij")).toBe(
      "playlist",
    );
    expect(detectUrlKind("https://www.youtube.com/playlist?list=PLabcdefghij")).toBe("playlist");
    expect(detectUrlKind("https://www.youtube.com/@SomeChannel")).toBe("channel");
    expect(detectUrlKind("https://www.youtube.com/@SomeChannel/shorts")).toBe("channel");
    expect(detectUrlKind("https://www.tiktok.com/@user/video/1234567890123")).toBe("video");
  });

  it("ignores YouTube mix playlists and reads a watch id", () => {
    expect(extractPlaylistId("https://www.youtube.com/watch?v=abc&list=RDmix123")).toBeNull();
    expect(extractPlaylistId("https://www.youtube.com/playlist?list=PLabcdefghij")).toBe(
      "PLabcdefghij",
    );
    expect(extractVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("normalizes a channel URL onto a listable tab", () => {
    expect(normalizeCollectionUrl("https://www.youtube.com/@SomeChannel", "shorts")).toBe(
      "https://www.youtube.com/@SomeChannel/shorts",
    );
    expect(detectChannelTab("https://www.youtube.com/@SomeChannel/videos")).toBe("videos");
    expect(detectChannelTab("https://www.youtube.com/@SomeChannel/about")).toBeNull();
  });

  it("accepts only http(s) URLs", () => {
    expect(isValidHttpUrl("https://youtu.be/abc")).toBe(true);
    expect(isValidHttpUrl("http://example.com/a")).toBe(true);
    expect(isValidHttpUrl("ftp://example.com/a")).toBe(false);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
  });
});
