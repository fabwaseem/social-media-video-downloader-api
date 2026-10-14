import { Controller, Get, Header, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator";

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Downloader</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.4rem; }
  label { display: block; margin: 0.8rem 0 0.3rem; font-size: 0.9rem; }
  input, select, button { font: inherit; width: 100%; box-sizing: border-box; padding: 0.55rem 0.7rem; }
  button { margin-top: 1rem; cursor: pointer; }
  progress { width: 100%; height: 1rem; margin-top: 1rem; }
  #log { white-space: pre-wrap; font-size: 0.9rem; }
  a { font-weight: 600; }
</style>
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
    <input id="key" name="key" type="password" autocomplete="off" placeholder="vz_...">
    <button type="submit">Download</button>
  </form>
  <progress id="bar" value="0" max="100" hidden></progress>
  <p id="log"></p>
  <p id="file"></p>
</main>
<script src="/playground.js"></script>
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
  @Get("playground.js")
  @Header("Content-Type", "application/javascript; charset=utf-8")
  script(): string {
    return SCRIPT;
  }
}
