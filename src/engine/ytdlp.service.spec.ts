import { execFile } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import type { CreateDownloadRequest } from "@downloader/shared";
import { AppConfigService } from "../config/app-config.service";
import { BinariesService } from "./binaries.service";
import type { Attempt } from "./resilience";
import { YtdlpService } from "./ytdlp.service";

jest.mock("child_process", () => {
  const actual = jest.requireActual("child_process");
  const { promisify } = require("util") as typeof import("util");
  const execFile = jest.fn();
  function custom(this: unknown, ...args: unknown[]) {
    return new Promise((resolve, reject) => {
      execFile.call(
        this,
        ...args,
        (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => {
          if (err) reject(Object.assign(err, { stdout, stderr }));
          else resolve({ stdout, stderr });
        },
      );
    });
  }
  Object.defineProperty(execFile, promisify.custom, { value: custom });
  return { ...actual, execFile };
});

const execFileMock = execFile as unknown as jest.Mock;
const fixture = readFileSync(join(process.cwd(), "test/fixtures/ytdlp-youtube.json"), "utf8");

function service(): YtdlpService {
  const binaries = {
    ensureReady: jest.fn().mockResolvedValue(undefined),
    ytdlp: { command: "yt-dlp", argsPrefix: [] as string[], source: "system" },
    jsRuntime: "node:/usr/bin/node",
    pluginDir: "",
    cookiesPath: "",
    ffmpegPath: "/usr/bin/ffmpeg",
  };
  const config = {
    ytdlpVerbose: false,
    ytdlpPotBaseUrl: "http://bgutil:4416",
    ytdlpProxy: "",
    ytdlpForceIpv4: true,
    ytdlpExtraArgs: [] as string[],
    ytdlpConcurrentFragments: 4,
    ytdlpMaxAttempts: 1,
    ytdlpRetryBaseMs: 0,
  };
  return new YtdlpService(binaries as unknown as BinariesService, config as unknown as AppConfigService);
}

function downloadArgs(
  engine: YtdlpService,
  attempt: Attempt,
  request: CreateDownloadRequest,
): string[] {
  return (
    engine as unknown as {
      buildDownloadArgs: (a: Attempt, r: CreateDownloadRequest, o: string) => string[];
    }
  ).buildDownloadArgs(attempt, request, "/tmp/out.%(ext)s");
}

describe("yt-dlp argument builder", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("puts -- immediately before the URL", () => {
    const args = downloadArgs(
      service(),
      { url, args: [], label: "default" },
      { url, kind: "video", quality: "720p", format: "mp4" },
    );
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe(url);
    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--js-runtimes");
    expect(args).toContain("node:/usr/bin/node");
    expect(args).toContain("--ffmpeg-location");
    expect(args).toContain("/usr/bin/ffmpeg");
    expect(args).toContain("--force-ipv4");
    expect(args).toContain("youtubepot-bgutilhttp:base_url=http://bgutil:4416");
    const formatIndex = args.indexOf("-f");
    expect(args[formatIndex + 1]).toContain("height<=720");
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("mp4");
  });

  it("keeps a URL that starts with a dash from being parsed as a flag", () => {
    const tricky = "--version";
    const args = downloadArgs(
      service(),
      { url: tricky, args: ["--user-agent", "TestAgent"], label: "desktop UA" },
      { url: tricky, kind: "audio", quality: "best", format: "mp3" },
    );
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe(tricky);
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
    expect(args).toContain("TestAgent");
  });
});

describe("recorded yt-dlp JSON", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("normalizes a dumped info JSON from a mocked process", async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, fixture, "");
      },
    );
    const info = await service().extractInfo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(info.id).toBe("dQw4w9WgXcQ");
    expect(info.platform).toBe("youtube");
    expect(info.title).toBe("Rick Astley - Never Gonna Give You Up");
    expect(info.durationSeconds).toBe(213);
    expect(info.uploader).toBe("Rick Astley");
    expect(info.qualities.video).toEqual(expect.arrayContaining(["highest", "1080p", "720p", "lowest"]));
    expect(info.qualities.video).not.toContain("144p");
    expect(info.subtitles).toEqual([{ lang: "en", name: "English", auto: false }]);

    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(args).toContain("--dump-json");
  });

  it("uses the first JSON document when yt-dlp prints several", async () => {
    const first = JSON.stringify(JSON.parse(fixture));
    const second = JSON.stringify({ id: "other", title: "Second entry" });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, `${first}\n${second}\n`, "");
      },
    );
    const info = await service().extractInfo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(info.id).toBe("dQw4w9WgXcQ");
    expect(info.title).not.toBe("Second entry");
  });
});
