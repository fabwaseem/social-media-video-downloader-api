import { Controller, Get, Header, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snagbox</title>
<link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/assets/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/brand/icon-512.png">
<link rel="stylesheet" href="/playground.css">
</head>
<body>
<header class="top">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/assets/brand/logo-dark.svg">
    <img class="logo" alt="Snagbox" src="/assets/brand/logo-light.svg" width="260" height="64">
  </picture>
  <p class="tag">Paste a link, snag the media.</p>
</header>
<main>
  <h1>Download a video</h1>
  <p>Paste a public URL. Progress streams from the API, then the file link appears here.</p>
  <form id="form">
    <label for="url">URL</label>
    <input id="url" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=...">
    <label for="kind">Kind</label>
    <select id="kind" name="kind">
      <option value="video">Video</option>
      <option value="audio">Audio</option>
    </select>
    <label for="format">Format</label>
    <select id="format" name="format">
      <option>mp4</option><option>webm</option><option>mkv</option><option>gif</option>
      <option>mp3</option><option>m4a</option><option>opus</option>
    </select>
    <label for="key">API key (optional)</label>
    <input id="key" name="key" type="password" autocomplete="off" placeholder="sb_...">
    <button type="submit">Download</button>
  </form>
  <progress id="bar" value="0" max="100" hidden></progress>
  <p id="log"></p>
  <p id="file"></p>
</main>
<script src="/playground.js"></script>
</body>
`;

const CSS = `:root {
  color-scheme: light dark;
  --ink: #111827;
  --paper: #f9fafb;
  --ember: #ff5e3a;
  --ember-2: #ff2d87;
  --mist: #6b7280;
  --line: #e5e7eb;
  --card: #ffffff;
  --signal: #ff2d87;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.5rem 0; }
.logo { height: 64px; width: auto; display: block; }
.tag { margin: 0; color: var(--mist); }
main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 1.6rem; letter-spacing: -0.03em; margin: 0 0 0.4rem; }
label { display: block; margin: 0.85rem 0 0.35rem; font-size: 0.85rem; font-weight: 650; }
input, select, button { font: inherit; width: 100%; padding: 0.65rem 0.75rem; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: inherit; }
input:focus, select:focus { outline: 2px solid var(--ember-2); outline-offset: 1px; }
button { margin-top: 1rem; cursor: pointer; background: linear-gradient(135deg, var(--ember), var(--ember-2)); color: #fff; border: 0; font-weight: 700; }
progress { width: 100%; height: 0.8rem; margin-top: 1rem; accent-color: var(--ember-2); }
#log { white-space: pre-wrap; }
a { color: var(--signal); font-weight: 700; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #0b0b10; --ink: #f9fafb; --card: #16161e; --line: #2c2c36; --mist: #9ca3af; }
}
@media (max-width: 640px) {
  .top { flex-direction: column; align-items: flex-start; }
}
`;

const SCRIPT = `const form = document.querySelector("#form");
const log = document.querySelector("#log");
const bar = document.querySelector("#bar");
const file = document.querySelector("#file");
const keyInput = document.querySelector("#key");
keyInput.value = sessionStorage.getItem("apiKey") || "";
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  file.textContent = "";
  bar.hidden = false;
  bar.value = 0;
  log.textContent = "Queuing…";
  const key = keyInput.value.trim();
  if (key) sessionStorage.setItem("apiKey", key);
  const headers = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  const body = {
    url: document.querySelector("#url").value.trim(),
    kind: document.querySelector("#kind").value,
    format: document.querySelector("#format").value,
  };
  const created = await fetch("/v2/downloads", { method: "POST", headers, body: JSON.stringify(body) });
  const job = await created.json();
  if (!created.ok) {
    log.textContent = job.message || "Request failed";
    return;
  }
  const stream = await fetch("/v2/downloads/" + job.id + "/events", { headers });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (data) => {
    if (data.type === "progress") {
      bar.value = data.percentage || 0;
      log.textContent = "Downloading " + Math.round(data.percentage || 0) + "%";
    } else if (data.type === "status") {
      log.textContent = data.status;
    } else if (data.type === "complete") {
      bar.value = 100;
      log.textContent = "Ready";
      const link = document.createElement("a");
      link.href = data.job.fileUrl;
      link.textContent = data.job.filename || "Download file";
      file.replaceChildren(link);
      return true;
    } else if (data.type === "error") {
      log.textContent = data.message || "Failed";
      return true;
    }
    return false;
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\\n\\n");
    buffer = parts.pop() || "";
    let stop = false;
    for (const part of parts) {
      const line = part.split("\\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      if (handle(JSON.parse(line.slice(5).trim()))) stop = true;
    }
    if (stop) break;
  }
});
`;

@Controller({ version: VERSION_NEUTRAL })
export class PlaygroundController {
  @Public()
  @SkipThrottle()
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  page(): string {
    return PAGE;
  }

  @Public()
  @SkipThrottle()
  @Get("playground.css")
  @Header("Content-Type", "text/css; charset=utf-8")
  styles(): string {
    return CSS;
  }

  @Public()
  @SkipThrottle()
  @Get("playground.js")
  @Header("Content-Type", "application/javascript; charset=utf-8")
  script(): string {
    return SCRIPT;
  }
}
