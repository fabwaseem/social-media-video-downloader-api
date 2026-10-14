import { Readable } from "stream";
import {
  SsrfError,
  assertAddressesPublic,
  assertPublicHttpUrl,
  fetchGuarded,
  isBlockedIp,
  isTrackedShortLink,
  resolveSourceUrl,
  type SafeFetchOptions,
} from "./safe-fetch";

describe("isBlockedIp", () => {
  it("rejects loopback, private, and link-local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "127.0.0.2",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "224.0.0.1",
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects private literals, obfuscated decimals, and non-http schemes", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1/latest")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("http://[::1]/")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("http://2130706433/")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("http://localhost/admin")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl("https://user:pass@example.com/")).toThrow(SsrfError);
    expect(assertPublicHttpUrl("https://t.co/abc").hostname).toBe("t.co");
    expect(assertPublicHttpUrl("https://fb.watch/xyz").hostname).toBe("fb.watch");
  });
});

describe("redirect guards", () => {
  const transport =
    (location: string) => async (url: URL, _options: SafeFetchOptions) => {
      if (url.hostname === "t.co" || url.hostname === "fb.watch") {
        return {
          status: 302,
          headers: { location },
          body: Readable.from([]),
        };
      }
      return { status: 200, headers: {}, body: Readable.from(["ok"]) };
    };

  it("refuses a short link that redirects at a private address", async () => {
    await expect(
      fetchGuarded("https://t.co/abc", {}, transport("http://127.0.0.1/secret")),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      fetchGuarded("https://fb.watch/abc", {}, transport("http://169.254.169.254/latest")),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      fetchGuarded("https://t.co/abc", {}, transport("http://10.0.0.5/admin")),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("follows a short link onto a public URL", async () => {
    const final = await resolveSourceUrl(
      "https://t.co/abc",
      {},
      transport("https://x.com/user/status/1234567890"),
    );
    expect(final).toBe("https://x.com/user/status/1234567890");
    expect(isTrackedShortLink("https://vm.tiktok.com/ZMabc/")).toBe(true);
    expect(isTrackedShortLink("https://www.youtube.com/watch?v=abc")).toBe(false);
  });

  it("rejects a DNS answer that includes a private address", () => {
    expect(() => assertAddressesPublic("cdn.example", ["1.1.1.1"])).not.toThrow();
    expect(() => assertAddressesPublic("t.co", ["1.1.1.1", "10.0.0.1"])).toThrow(SsrfError);
    expect(() => assertAddressesPublic("metadata", ["169.254.169.254"])).toThrow(SsrfError);
  });

  it("stops reading once the size limit is passed", async () => {
    const body = Readable.from([Buffer.alloc(1000), Buffer.alloc(1000)]);
    const response = await fetchGuarded("https://cdn.example/video.mp4", { maxBytes: 1500 }, async () => ({
      status: 200,
      headers: {},
      body,
    }));
    await expect(response.text()).rejects.toThrow(/byte limit/);
  });

  it("rejects a content-length above the limit before the body is read", async () => {
    const seen: string[] = [];
    await expect(
      fetchGuarded("https://cdn.example/video.mp4", { maxBytes: 10 }, async (url) => {
        seen.push(url.toString());
        return {
          status: 200,
          headers: { "content-length": "99999" },
          body: Readable.from(["too big"]),
        };
      }),
    ).rejects.toThrow(/byte limit/);
    expect(seen).toEqual(["https://cdn.example/video.mp4"]);
  });
});
