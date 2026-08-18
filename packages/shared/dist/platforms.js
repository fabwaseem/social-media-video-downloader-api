"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_TAB_LABELS = exports.CHANNEL_TABS = exports.PLATFORM_META = exports.PLATFORMS = void 0;
exports.detectPlatform = detectPlatform;
exports.extractPlaylistId = extractPlaylistId;
exports.extractVideoUrl = extractVideoUrl;
exports.detectUrlKind = detectUrlKind;
exports.detectChannelTab = detectChannelTab;
exports.normalizeCollectionUrl = normalizeCollectionUrl;
exports.isValidHttpUrl = isValidHttpUrl;
/**
 * Supported platforms and URL detection shared by API and web.
 */
exports.PLATFORMS = ["youtube", "instagram", "tiktok", "twitter", "facebook"];
exports.PLATFORM_META = {
    youtube: {
        id: "youtube",
        name: "YouTube",
        slug: "youtube",
        color: "#ff0033",
        domains: ["youtube.com", "youtu.be", "music.youtube.com"],
        example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
    instagram: {
        id: "instagram",
        name: "Instagram",
        slug: "instagram",
        color: "#e1306c",
        domains: ["instagram.com", "instagr.am"],
        example: "https://www.instagram.com/reel/Cxyz.../",
    },
    tiktok: {
        id: "tiktok",
        name: "TikTok",
        slug: "tiktok",
        color: "#25f4ee",
        domains: ["tiktok.com", "vm.tiktok.com"],
        example: "https://www.tiktok.com/@user/video/1234567890",
    },
    twitter: {
        id: "twitter",
        name: "X / Twitter",
        slug: "twitter",
        color: "#1d9bf0",
        domains: ["twitter.com", "x.com", "t.co"],
        example: "https://x.com/user/status/1234567890",
    },
    facebook: {
        id: "facebook",
        name: "Facebook",
        slug: "facebook",
        color: "#1877f2",
        domains: ["facebook.com", "fb.watch", "fb.com", "m.facebook.com"],
        example: "https://www.facebook.com/watch?v=1234567890",
    },
};
const URL_PATTERNS = {
    youtube: [
        /^(https?:\/\/)?(www\.|m\.|music\.)?youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/|playlist\?list=)[\w-]+/i,
        /^(https?:\/\/)?youtu\.be\/[\w-]+/i,
    ],
    instagram: [/^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[\w.-]+/i],
    tiktok: [
        /^(https?:\/\/)?(www\.|m\.)?tiktok\.com\/@[\w.-]+\/(video|photo)\/\d+/i,
        /^(https?:\/\/)?(vm|vt)\.tiktok\.com\/[\w-]+/i,
        /^(https?:\/\/)?(www\.)?tiktok\.com\/t\/[\w-]+/i,
    ],
    twitter: [/^(https?:\/\/)?(www\.|mobile\.)?(twitter|x)\.com\/[\w]+\/status\/\d+/i],
    facebook: [
        /^(https?:\/\/)?(www\.|m\.|web\.)?facebook\.com\/.+\/videos\/.+/i,
        /^(https?:\/\/)?(www\.|m\.|web\.)?facebook\.com\/(watch|reel|share)[/?].+/i,
        /^(https?:\/\/)?fb\.watch\/[\w-]+/i,
    ],
};
/** Returns the platform a URL belongs to, or null when unsupported. */
function detectPlatform(url) {
    const trimmed = url.trim();
    if (!trimmed)
        return null;
    for (const platform of exports.PLATFORMS) {
        if (URL_PATTERNS[platform].some((re) => re.test(trimmed)))
            return platform;
    }
    // Fallback: match on hostname for shortened/odd links.
    try {
        const { hostname } = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
        for (const platform of exports.PLATFORMS) {
            if (exports.PLATFORM_META[platform].domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
                return platform;
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
/** Channel tabs we can list. Each is a separate playlist to yt-dlp. */
exports.CHANNEL_TABS = ["videos", "shorts", "streams"];
exports.CHANNEL_TAB_LABELS = {
    videos: "Videos",
    shorts: "Shorts",
    streams: "Live",
};
/** Channel path shapes: /@handle, /channel/UC…, /c/Name, /user/Name. */
const CHANNEL_PATH = /^\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(?:\/([\w-]+))?\/?$/i;
function youtubeUrl(url) {
    const trimmed = url.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
        const host = parsed.hostname.replace(/^(www|m|music)\./i, "").toLowerCase();
        return host === "youtube.com" || host === "youtu.be" ? parsed : null;
    }
    catch {
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
function extractPlaylistId(url) {
    const parsed = youtubeUrl(url);
    const list = parsed?.searchParams.get("list")?.trim();
    if (!list || /^RD/i.test(list))
        return null;
    return list;
}
/** The single video a `/watch` URL names, stripped of any playlist rider. */
function extractVideoUrl(url) {
    const parsed = youtubeUrl(url);
    if (!parsed)
        return null;
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
function detectUrlKind(url) {
    const parsed = youtubeUrl(url);
    if (!parsed)
        return "video";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/playlist")
        return extractPlaylistId(url) ? "playlist" : "video";
    if (path === "/watch" || path === "/live" || path.startsWith("/shorts/")) {
        return extractPlaylistId(url) ? "playlist" : "video";
    }
    // /@handle and /@handle/<anything> (featured, playlists, community…) all
    // identify a channel; we just list it through the tabs we support.
    return CHANNEL_PATH.test(path) ? "channel" : "video";
}
/** The tab a channel URL already names, when it is one we can list. */
function detectChannelTab(url) {
    const parsed = youtubeUrl(url);
    if (!parsed)
        return null;
    const match = CHANNEL_PATH.exec(parsed.pathname.replace(/\/+$/, "") || "/");
    const tab = match?.[1]?.toLowerCase();
    return exports.CHANNEL_TABS.includes(tab) ? tab : null;
}
/**
 * Rewrites a channel URL to point at one listable tab.
 *
 * A bare `/@handle` makes yt-dlp return the channel's *tabs* as nested
 * playlists rather than videos, so every channel request has to name a tab.
 * Playlist URLs are returned untouched.
 */
function normalizeCollectionUrl(url, tab = "videos") {
    const parsed = youtubeUrl(url);
    if (!parsed)
        return url.trim();
    const kind = detectUrlKind(url);
    if (kind === "playlist") {
        // Canonical playlist form. Listing a `/watch?v=…&list=…` link directly
        // works but comes back without the playlist's own channel attribution.
        const list = extractPlaylistId(url);
        return list ? `https://www.youtube.com/playlist?list=${list}` : url.trim();
    }
    if (kind !== "channel")
        return url.trim();
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const match = CHANNEL_PATH.exec(path);
    if (!match)
        return url.trim();
    const base = path.slice(0, path.length - (match[1] ? match[1].length + 1 : 0));
    return `https://www.youtube.com${base.replace(/\/+$/, "")}/${tab}`;
}
function isValidHttpUrl(value) {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
