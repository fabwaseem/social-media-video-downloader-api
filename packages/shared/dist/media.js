"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIO_QUALITY_LABELS = exports.VIDEO_QUALITY_LABELS = exports.AUDIO_FORMATS = exports.VIDEO_FORMATS = exports.AUDIO_QUALITIES = exports.VIDEO_QUALITIES = void 0;
exports.VIDEO_QUALITIES = [
    "2160p",
    "1440p",
    "1080p",
    "720p",
    "480p",
    "360p",
    "240p",
    "144p",
    "highest",
    "lowest",
];
exports.AUDIO_QUALITIES = ["best", "high", "medium", "low"];
exports.VIDEO_FORMATS = ["mp4", "mkv", "webm"];
exports.AUDIO_FORMATS = ["mp3", "m4a", "opus", "wav", "flac"];
exports.VIDEO_QUALITY_LABELS = {
    "2160p": "4K Ultra HD (2160p)",
    "1440p": "2K QHD (1440p)",
    "1080p": "Full HD (1080p)",
    "720p": "HD (720p)",
    "480p": "SD (480p)",
    "360p": "360p",
    "240p": "240p",
    "144p": "144p",
    highest: "Best available",
    lowest: "Smallest file",
};
exports.AUDIO_QUALITY_LABELS = {
    best: "Best (320 kbps)",
    high: "High (256 kbps)",
    medium: "Medium (192 kbps)",
    low: "Low (128 kbps)",
};
