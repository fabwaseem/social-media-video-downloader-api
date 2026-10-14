import * as os from "os";

/**
 * Release downloaded when no yt-dlp binary is already installed.
 * Override with YTDLP_VERSION. Checksums are for this pin only.
 */
export const PINNED_YTDLP_VERSION = "2026.08.19";

export const PINNED_SHA256: Record<string, string> = {
  "2026.08.19/yt-dlp": "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6",
  "2026.08.19/yt-dlp.exe": "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
  "2026.08.19/yt-dlp_linux": "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
  "2026.08.19/yt-dlp_linux_aarch64": "b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc",
  "2026.08.19/yt-dlp_macos": "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  "2026.08.19/yt-dlp_x86.exe": "a8f91bd41452506bc81ebd2f369b186fea0ee7075413ba00cef9fd346a0a5d0c",
};

export function resolveYtdlpVersion(configured: string): string {
  const trimmed = configured.trim();
  return trimmed || PINNED_YTDLP_VERSION;
}

export function ytdlpAssetUrl(version: string, name: string): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${name}`;
}

export function pinnedChecksum(version: string, name: string): string | undefined {
  return PINNED_SHA256[`${version}/${name}`];
}

export function standaloneAssetName(platform = os.platform(), arch = os.arch()): string | null {
  if (platform === "win32") return arch === "x64" ? "yt-dlp.exe" : "yt-dlp_x86.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "linux") {
    if (arch === "x64") return "yt-dlp_linux";
    if (arch === "arm64") return "yt-dlp_linux_aarch64";
  }
  return null;
}
