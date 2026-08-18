/**
 * Supported platforms and URL detection shared by API and web.
 */
export declare const PLATFORMS: readonly ["youtube", "instagram", "tiktok", "twitter", "facebook"];
export type Platform = (typeof PLATFORMS)[number];
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
export declare const PLATFORM_META: Record<Platform, PlatformMeta>;
/** Returns the platform a URL belongs to, or null when unsupported. */
export declare function detectPlatform(url: string): Platform | null;
/** What a supported URL points at. */
export type UrlKind = "video" | "playlist" | "channel";
/** Channel tabs we can list. Each is a separate playlist to yt-dlp. */
export declare const CHANNEL_TABS: readonly ["videos", "shorts", "streams"];
export type ChannelTab = (typeof CHANNEL_TABS)[number];
export declare const CHANNEL_TAB_LABELS: Record<ChannelTab, string>;
/**
 * The playlist a URL belongs to, from either `/playlist?list=…` or the
 * `list=` rider on a `/watch` link.
 *
 * "RD…" mixes are YouTube's endless auto-generated radio — they have no fixed
 * membership, so treating one as a downloadable playlist would promise a list
 * that never settles.
 */
export declare function extractPlaylistId(url: string): string | null;
/** The single video a `/watch` URL names, stripped of any playlist rider. */
export declare function extractVideoUrl(url: string): string | null;
/**
 * Classifies a URL as a single video, a playlist, or a channel.
 *
 * A `/watch?v=…&list=…` link carries both a video and a playlist. It resolves
 * to the playlist, because that is the larger of the two intents and the
 * single video stays one click away from the listing.
 *
 * Only YouTube exposes collections today; everything else is a single video.
 */
export declare function detectUrlKind(url: string): UrlKind;
/** The tab a channel URL already names, when it is one we can list. */
export declare function detectChannelTab(url: string): ChannelTab | null;
/**
 * Rewrites a channel URL to point at one listable tab.
 *
 * A bare `/@handle` makes yt-dlp return the channel's *tabs* as nested
 * playlists rather than videos, so every channel request has to name a tab.
 * Playlist URLs are returned untouched.
 */
export declare function normalizeCollectionUrl(url: string, tab?: ChannelTab): string;
export declare function isValidHttpUrl(value: string): boolean;
