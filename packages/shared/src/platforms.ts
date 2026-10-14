import { PLATFORM_PLUGINS, type KnownPlatform as PluginId, type PlatformPlugin } from "./platform-plugins";

export { PLATFORM_PLUGINS, PLATFORMS, type PlatformPlugin } from "./platform-plugins";

/**
 * Supported platforms and URL detection shared by API and web.
 * `generic` is not detected; callers opt into it for any other public URL.
 */
export type KnownPlatform = PluginId;
export type Platform = KnownPlatform | "generic";

export interface PlatformMeta {
  id: Platform;
  name: string;
  /** Route slug used by the web app (`/youtube`, ...). */
  slug: string;
  /** Brand accent color used by the UI. */
  color: string;
  domains: string[];
  example: string;
  comingSoon?: boolean;
}

function metaFromPlugin(plugin: PlatformPlugin): PlatformMeta {
  return {
    id: plugin.id as KnownPlatform,
    name: plugin.name,
    slug: plugin.slug,
    color: plugin.color,
    domains: plugin.domains,
    example: plugin.example,
  };
}

export const PLATFORM_META = Object.fromEntries([
  ...PLATFORM_PLUGINS.map((plugin) => [plugin.id, metaFromPlugin(plugin)] as const),
  [
    "generic",
    {
      id: "generic",
      name: "Generic",
      slug: "generic",
      color: "#666666",
      domains: [] as string[],
      example: "https://example.com/video",
    } satisfies PlatformMeta,
  ] as const,
]) as Record<Platform, PlatformMeta>;

/** Returns the platform a URL belongs to, or null when it is not a known plugin. */
export function detectPlatform(url: string): KnownPlatform | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  for (const plugin of PLATFORM_PLUGINS) {
    if (plugin.patterns.some((pattern) => pattern.test(trimmed))) return plugin.id;
  }
  try {
    const { hostname } = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    for (const plugin of PLATFORM_PLUGINS) {
      if (plugin.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
        return plugin.id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Known plugin, or `generic` when that mode is on and the value is an http(s) URL.
 * The API still has to reject private addresses before it fetches the URL.
 */
export function resolvePlatform(url: string, allowGeneric: boolean): Platform | null {
  const known = detectPlatform(url);
  if (known) return known;
  if (allowGeneric && isValidHttpUrl(url)) return "generic";
  return null;
}

/* ------------------------------------------------------ collection URLs -- */

/** What a supported URL points at. */
export type UrlKind = "video" | "playlist" | "channel";

/** Channel tabs we can list. Each is a separate playlist to yt-dlp. */
export const CHANNEL_TABS = ["videos", "shorts", "streams"] as const;
export type ChannelTab = (typeof CHANNEL_TABS)[number];

export const CHANNEL_TAB_LABELS: Record<ChannelTab, string> = {
  videos: "Videos",
  shorts: "Shorts",
  streams: "Live",
};

/** Channel path shapes: /@handle, /channel/UC…, /c/Name, /user/Name. */
const CHANNEL_PATH =
  /^\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(?:\/([\w-]+))?\/?$/i;

function youtubeUrl(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^(www|m|music)\./i, "").toLowerCase();
    return host === "youtube.com" || host === "youtu.be" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The playlist a URL belongs to, from either `/playlist?list=…` or the
 * `list=` rider on a `/watch` link.
 *
 * "RD…" mixes are YouTube's endless auto-generated radio — they have no fixed
 * membership, so treating one as a downloadable playlist would promise a list
 * that never settles.
 */
export function extractPlaylistId(url: string): string | null {
  const parsed = youtubeUrl(url);
  const list = parsed?.searchParams.get("list")?.trim();
  if (!list || /^RD/i.test(list)) return null;
  return list;
}

/** The single video a `/watch` URL names, stripped of any playlist rider. */
export function extractVideoUrl(url: string): string | null {
  const parsed = youtubeUrl(url);
  if (!parsed) return null;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path === "/watch") {
    const v = parsed.searchParams.get("v");
    return v ? `https://www.youtube.com/watch?v=${v}` : null;
  }
  if (parsed.hostname.endsWith("youtu.be")) {
    const id = path.slice(1);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  return null;
}

/**
 * Classifies a URL as a single video, a playlist, or a channel.
 *
 * A `/watch?v=…&list=…` link carries both a video and a playlist. It resolves
 * to the playlist, because that is the larger of the two intents and the
 * single video stays one click away from the listing.
 *
 * Only YouTube exposes collections today; everything else is a single video.
 */
export function detectUrlKind(url: string): UrlKind {
  const parsed = youtubeUrl(url);
  if (!parsed) return "video";

  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  if (path === "/playlist") return extractPlaylistId(url) ? "playlist" : "video";
  if (path === "/watch" || path === "/live" || path.startsWith("/shorts/")) {
    return extractPlaylistId(url) ? "playlist" : "video";
  }

  // /@handle and /@handle/<anything> (featured, playlists, community…) all
  // identify a channel; we just list it through the tabs we support.
  return CHANNEL_PATH.test(path) ? "channel" : "video";
}

/** The tab a channel URL already names, when it is one we can list. */
export function detectChannelTab(url: string): ChannelTab | null {
  const parsed = youtubeUrl(url);
  if (!parsed) return null;
  const match = CHANNEL_PATH.exec(parsed.pathname.replace(/\/+$/, "") || "/");
  const tab = match?.[1]?.toLowerCase();
  return CHANNEL_TABS.includes(tab as ChannelTab) ? (tab as ChannelTab) : null;
}

/**
 * Rewrites a channel URL to point at one listable tab.
 *
 * A bare `/@handle` makes yt-dlp return the channel's *tabs* as nested
 * playlists rather than videos, so every channel request has to name a tab.
 * Playlist URLs are returned untouched.
 */
export function normalizeCollectionUrl(url: string, tab: ChannelTab = "videos"): string {
  const parsed = youtubeUrl(url);
  if (!parsed) return url.trim();

  const kind = detectUrlKind(url);
  if (kind === "playlist") {
    // Canonical playlist form. Listing a `/watch?v=…&list=…` link directly
    // works but comes back without the playlist's own channel attribution.
    const list = extractPlaylistId(url);
    return list ? `https://www.youtube.com/playlist?list=${list}` : url.trim();
  }
  if (kind !== "channel") return url.trim();

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const match = CHANNEL_PATH.exec(path);
  if (!match) return url.trim();

  const base = path.slice(0, path.length - (match[1] ? match[1].length + 1 : 0));
  return `https://www.youtube.com${base.replace(/\/+$/, "")}/${tab}`;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
