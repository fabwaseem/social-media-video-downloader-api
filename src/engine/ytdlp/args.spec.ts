import { buildDownloadArgs, type YtdlpArgContext } from "./args";

const ctx: YtdlpArgContext = {
  verbose: false,
  jsRuntime: "",
  pluginDir: "",
  cookiesPath: "",
  potBaseUrl: "",
  proxy: "",
  forceIpv4: false,
  ffmpegPath: "ffmpeg",
  extraArgs: [],
  concurrentFragments: 4,
};

describe("download output options", () => {
  const attempt = { url: "https://vimeo.com/1", args: [] as string[], label: "default" };

  it("recodes a gif and forces H.264 when asked", () => {
    const gif = buildDownloadArgs(ctx, attempt, { url: attempt.url, kind: "video", format: "gif" }, "/tmp/out.%(ext)s");
    expect(gif).toContain("--recode-video");
    expect(gif).toContain("gif");

    const h264 = buildDownloadArgs(
      ctx,
      attempt,
      { url: attempt.url, kind: "video", format: "mp4", videoCodec: "h264" },
      "/tmp/out.%(ext)s",
    );
    expect(h264.join(" ")).toContain("libx264");
  });

  it("embeds audio metadata and cover art together", () => {
    const args = buildDownloadArgs(
      ctx,
      attempt,
      { url: attempt.url, kind: "audio", format: "mp3", embedThumbnail: true, embedMetadata: true },
      "/tmp/out.%(ext)s",
    );
    expect(args).toContain("--embed-thumbnail");
    expect(args).toContain("--embed-metadata");
    expect(args.at(-2)).toBe("--");
  });
});