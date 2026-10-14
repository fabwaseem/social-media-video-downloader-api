/**
 * One object per site. Append a plugin here to support another host;
 * detection, the platform list, and the docs matrix all read this registry.
 */
export const PLATFORMS = [
  "youtube",
  "instagram",
  "tiktok",
  "twitter",
  "facebook",
  "reddit",
  "vimeo",
  "bluesky",
  "threads",
  "pinterest",
  "twitch",
  "soundcloud",
  "snapchat",
] as const;

export type KnownPlatform = (typeof PLATFORMS)[number];

export interface PlatformPlugin {
  id: KnownPlatform;
  name: string;
  slug: string;
  color: string;
  domains: string[];
  example: string;
  patterns: RegExp[];
}

export const PLATFORM_PLUGINS: readonly PlatformPlugin[] = [
  {
    id: "youtube",
    name: "YouTube",
    slug: "youtube",
    color: "#ff0033",
    domains: ["youtube.com", "youtu.be", "music.youtube.com"],
    example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    patterns: [
      /^(https?:\/\/)?(www\.|m\.|music\.)?youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/|playlist\?list=)[\w-]+/i,
      /^(https?:\/\/)?youtu\.be\/[\w-]+/i,
    ],
  },
  {
    id: "instagram",
    name: "Instagram",
    slug: "instagram",
    color: "#e1306c",
    domains: ["instagram.com", "instagr.am"],
    example: "https://www.instagram.com/reel/Cxyz.../",
    patterns: [/^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[\w.-]+/i],
  },
  {
    id: "tiktok",
    name: "TikTok",
    slug: "tiktok",
    color: "#25f4ee",
    domains: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    example: "https://www.tiktok.com/@user/video/1234567890",
    patterns: [
      /^(https?:\/\/)?(www\.|m\.)?tiktok\.com\/@[\w.-]+\/(video|photo)\/\d+/i,
      /^(https?:\/\/)?(vm|vt)\.tiktok\.com\/[\w-]+/i,
      /^(https?:\/\/)?(www\.)?tiktok\.com\/t\/[\w-]+/i,
    ],
  },
  {
    id: "twitter",
    name: "X / Twitter",
    slug: "twitter",
    color: "#1d9bf0",
    domains: ["twitter.com", "x.com", "t.co"],
    example: "https://x.com/user/status/1234567890",
    patterns: [/^(https?:\/\/)?(www\.|mobile\.)?(twitter|x)\.com\/[\w]+\/status\/\d+/i],
  },
  {
    id: "facebook",
    name: "Facebook",
    slug: "facebook",
    color: "#1877f2",
    domains: ["facebook.com", "fb.watch", "fb.com"],
    example: "https://www.facebook.com/watch?v=1234567890",
    patterns: [
      /^(https?:\/\/)?(www\.|m\.|web\.)?facebook\.com\/.+\/videos\/.+/i,
      /^(https?:\/\/)?(www\.|m\.|web\.)?facebook\.com\/(watch|reel|share)[/?].+/i,
      /^(https?:\/\/)?fb\.watch\/[\w-]+/i,
    ],
  },
  {
    id: "reddit",
    name: "Reddit",
    slug: "reddit",
    color: "#ff4500",
    domains: ["reddit.com", "redd.it", "v.redd.it"],
    example: "https://www.reddit.com/r/videos/comments/abc123/title/",
    patterns: [
      /^(https?:\/\/)?(www\.|old\.|new\.)?reddit\.com\/r\/[\w.-]+\/comments\/[\w]+/i,
      /^(https?:\/\/)?(www\.)?reddit\.com\/video\/[\w]+/i,
      /^(https?:\/\/)?v\.redd\.it\/[\w]+/i,
      /^(https?:\/\/)?redd\.it\/[\w]+/i,
    ],
  },
  {
    id: "vimeo",
    name: "Vimeo",
    slug: "vimeo",
    color: "#1ab7ea",
    domains: ["vimeo.com"],
    example: "https://vimeo.com/76979871",
    patterns: [/^(https?:\/\/)?(www\.|player\.)?vimeo\.com\/(?:video\/)?\d+/i],
  },
  {
    id: "bluesky",
    name: "Bluesky",
    slug: "bluesky",
    color: "#1185fe",
    domains: ["bsky.app"],
    example: "https://bsky.app/profile/user.bsky.social/post/abc123",
    patterns: [/^(https?:\/\/)?(www\.)?bsky\.app\/profile\/[\w.-]+\/post\/[\w]+/i],
  },
  {
    id: "threads",
    name: "Threads",
    slug: "threads",
    color: "#101010",
    domains: ["threads.net", "threads.com"],
    example: "https://www.threads.net/@user/post/abc123",
    patterns: [/^(https?:\/\/)?(www\.)?threads\.(net|com)\/@[\w.-]+\/post\/[\w]+/i],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    slug: "pinterest",
    color: "#e60023",
    domains: ["pinterest.com", "pin.it"],
    example: "https://www.pinterest.com/pin/1234567890/",
    patterns: [
      /^(https?:\/\/)?(www\.)?pinterest\.[\w.]+\/pin\/\d+/i,
      /^(https?:\/\/)?pin\.it\/[\w]+/i,
    ],
  },
  {
    id: "twitch",
    name: "Twitch clips",
    slug: "twitch",
    color: "#9146ff",
    domains: ["clips.twitch.tv"],
    example: "https://clips.twitch.tv/ExampleClipName",
    patterns: [
      /^(https?:\/\/)?clips\.twitch\.tv\/[\w-]+/i,
      /^(https?:\/\/)?(www\.)?twitch\.tv\/[\w]+\/clip\/[\w-]+/i,
    ],
  },
  {
    id: "soundcloud",
    name: "SoundCloud",
    slug: "soundcloud",
    color: "#ff5500",
    domains: ["soundcloud.com"],
    example: "https://soundcloud.com/artist/track",
    patterns: [/^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\/[\w.-]+\/[\w.-]+/i],
  },
  {
    id: "snapchat",
    name: "Snapchat",
    slug: "snapchat",
    color: "#fffc00",
    domains: ["snapchat.com", "story.snapchat.com"],
    example: "https://www.snapchat.com/spotlight/abc123",
    patterns: [
      /^(https?:\/\/)?(www\.)?snapchat\.com\/(spotlight|t|add)\/[\w.-]+/i,
      /^(https?:\/\/)?story\.snapchat\.com\/.+/i,
    ],
  },
];

export function pluginById(id: string): PlatformPlugin | undefined {
  return PLATFORM_PLUGINS.find((plugin) => plugin.id === id);
}
