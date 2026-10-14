import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { AppConfigService } from "../config/app-config.service";
import { SsrfError, safeFetch } from "../common/http/safe-fetch";
import { BinariesService } from "./binaries.service";
import { DirectDownloadService } from "./direct-download.service";

jest.mock("../common/http/safe-fetch", () => {
  const actual = jest.requireActual("../common/http/safe-fetch");
  return { ...actual, safeFetch: jest.fn() };
});

const fetchMock = safeFetch as jest.MockedFunction<typeof safeFetch>;

describe("DirectDownloadService", () => {
  const config = {
    directDownloadTimeoutMs: 15_000,
    directDownloadMaxBytes: 1024,
  } as AppConfigService;
  const service = new DirectDownloadService({ ffmpegPath: "ffmpeg" } as BinariesService, config);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("passes the timeout and size limit through to the guarded fetch", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      url: "https://cdn.example/a.mp4",
      headers: { "content-length": "4" },
      body: Readable.from([Buffer.from("data")]),
      text: async () => "data",
    });
    const dir = await mkdtemp(join(tmpdir(), "direct-"));
    const output = join(dir, "clip.mp4");
    try {
      await service.download({ url: "https://cdn.example/a.mp4", outputPath: output });
      expect(await readFile(output, "utf8")).toBe("data");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://cdn.example/a.mp4",
        expect.objectContaining({ timeoutMs: 15_000, maxBytes: 1024 }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a media host that fails the SSRF check", async () => {
    fetchMock.mockRejectedValue(new SsrfError("Refusing to connect to a non-public address."));
    await expect(
      service.download({ url: "http://127.0.0.1/secret", outputPath: "/tmp/nope.mp4" }),
    ).rejects.toThrow(/not allowed/);
  });
});
