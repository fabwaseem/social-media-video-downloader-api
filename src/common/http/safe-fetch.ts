import { lookup as dnsLookup, type LookupAddress } from "dns";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { BlockList, isIP } from "net";
import { Readable, Transform } from "stream";
import type { IncomingHttpHeaders } from "http";

/**
 * Refusal to connect to a private, loopback, or link-local address.
 *
 * Thrown for the URL we were handed and for every redirect hop after it, so a
 * public short link (t.co, fb.watch, vm.tiktok.com) cannot bounce the server
 * at an internal address.
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addRange("224.0.0.0", "255.255.255.255", "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

/** True for loopback, private, link-local, multicast, and unspecified addresses. */
export function isBlockedIp(address: string): boolean {
  let ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  const family = isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/** Decimal forms such as 2130706433 (127.0.0.1) never reach DNS as dotted quads. */
function obfuscatedIpv4(hostname: string): string | null {
  if (!/^\d+$/.test(hostname)) return null;
  const value = Number(hostname);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
  const literal = isIP(host) ? host : obfuscatedIpv4(host);
  return literal != null && isBlockedIp(literal);
}

/**
 * Rejects non-http(s) URLs, embedded credentials, and hosts that are already
 * a private or link-local address. DNS answers are checked separately, at
 * connect time, so a public name that resolves privately is still refused.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("The URL is not a valid http(s) address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http and https URLs can be fetched.");
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with embedded credentials are not allowed.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new SsrfError("Refusing to connect to a non-public address.");
  }
  return url;
}

/** Rejects a DNS answer that contains any non-public address. */
export function assertAddressesPublic(hostname: string, addresses: string[]): void {
  if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
    throw new SsrfError(`Refusing to connect to a non-public address for ${hostname}.`);
  }
}

const SHORT_LINK_HOSTS = new Set(["t.co", "fb.watch", "vm.tiktok.com", "vt.tiktok.com"]);

/** Short links whose redirect target must be checked before yt-dlp sees them. */
export function isTrackedShortLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (SHORT_LINK_HOSTS.has(host)) return true;
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return /^\/t\//i.test(url.pathname);
  }
  return false;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: IncomingHttpHeaders;
  body: Readable;
  text(): Promise<string>;
}

interface HopResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Readable;
}

type Transport = (url: URL, options: SafeFetchOptions) => Promise<HopResponse>;

function headerNumber(headers: IncomingHttpHeaders, name: string): number {
  const value = headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function limitBody(source: Readable, maxBytes: number | undefined): Readable {
  if (!maxBytes || maxBytes <= 0) return source;
  let seen = 0;
  const limiter = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes =
        typeof chunk === "string" ? Buffer.byteLength(chunk, encoding as BufferEncoding) : chunk.length;
      seen += bytes;
      if (seen > maxBytes) {
        callback(new Error(`Response exceeded the ${maxBytes} byte limit`));
        return;
      }
      callback(null, chunk);
    },
  });
  limiter.on("error", () => source.destroy());
  source.pipe(limiter);
  return limiter;
}

function headersForHop(
  from: URL,
  to: URL,
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers || from.host === to.host) return headers;
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) continue;
    copy[key] = value;
  }
  return copy;
}

function safeLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "");
      return;
    }
    const list = addresses as LookupAddress[];
    try {
      assertAddressesPublic(hostname, list.map((entry) => entry.address));
    } catch (error) {
      const wrapped = error as NodeJS.ErrnoException;
      wrapped.code = "ESSRF";
      callback(wrapped, "");
      return;
    }
    if ((options as { all?: boolean }).all) {
      callback(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
}

function defaultTransport(url: URL, options: SafeFetchOptions): Promise<HopResponse> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        lookup: safeLookup as never,
        timeout: timeoutMs,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
        });
      },
    );
    const fail = (error: Error) => {
      req.destroy();
      reject(error);
    };
    req.on("error", (error) => reject(error));
    req.on("timeout", () => fail(new Error("Request timed out")));
    if (options.body) req.write(options.body);
    if (options.signal) {
      const onAbort = () => fail(new Error("Request aborted"));
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => options.signal?.removeEventListener("abort", onAbort));
    }
    req.end();
  });
}

async function readText(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetches `rawUrl`, following redirects itself and refusing any hop whose host
 * is a private, loopback, or link-local address.
 */
export async function fetchGuarded(
  rawUrl: string,
  options: SafeFetchOptions = {},
  transport: Transport = defaultTransport,
): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = assertPublicHttpUrl(rawUrl);
  let hopHeaders = options.headers;

  for (let hop = 0; ; hop++) {
    const response = await transport(current, { ...options, headers: hopHeaders });
    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (!isRedirect) {
      const length = headerNumber(response.headers, "content-length");
      if (options.maxBytes && length > options.maxBytes) {
        response.body.destroy();
        throw new Error(`Response exceeded the ${options.maxBytes} byte limit`);
      }
      const body = limitBody(response.body, options.maxBytes);
      const finalUrl = current.toString();
      return {
        status: response.status,
        url: finalUrl,
        headers: response.headers,
        body,
        text: () => readText(body),
      };
    }

    response.body.resume();
    if (hop >= maxRedirects) throw new SsrfError("Too many redirects.");
    const next = assertPublicHttpUrl(new URL(String(response.headers.location), current).toString());
    hopHeaders = headersForHop(current, next, hopHeaders);
    current = next;
  }
}

export function safeFetch(rawUrl: string, options?: SafeFetchOptions): Promise<SafeResponse> {
  return fetchGuarded(rawUrl, options);
}

/**
 * Returns `raw` unchanged when it is already a public http(s) URL, and follows
 * short links (t.co, fb.watch, TikTok vm/vt//t) to their final public URL.
 */
export async function resolveSourceUrl(
  raw: string,
  options: SafeFetchOptions = {},
  transport?: Transport,
): Promise<string> {
  assertPublicHttpUrl(raw);
  if (!isTrackedShortLink(raw)) return raw;
  const response = await fetchGuarded(
    raw,
    {
      method: "GET",
      timeoutMs: 20_000,
      maxRedirects: 5,
      maxBytes: 1024 * 1024,
      ...options,
    },
    transport,
  );
  response.body.resume();
  if (response.status >= 400) {
    throw new SsrfError(`Short link returned HTTP ${response.status}.`);
  }
  return response.url;
}

/** Exposed so tests can assert the connect-time lookup refuses private answers. */
export function lookupPublic(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  safeLookup(hostname, options, callback);
}
