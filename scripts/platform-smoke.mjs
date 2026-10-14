import { spawn } from "node:child_process";

/** Public examples. A failure here does not run on pull requests. */
const CASES = [
  ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["vimeo", "https://vimeo.com/76979871"],
  ["reddit", "https://www.reddit.com/r/videos/"],
  ["soundcloud", "https://soundcloud.com/forss/flickermood"],
];

function probe(url) {
  return new Promise((resolve) => {
    const child = spawn(
      "yt-dlp",
      ["--dump-json", "--skip-download", "--no-warnings", "--ignore-config", "--socket-timeout", "20", "--", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? null : stderr.slice(-400) || `exit ${code}`);
    });
  });
}

let failed = 0;
for (const [name, url] of CASES) {
  const error = await probe(url);
  if (error) {
    failed += 1;
    console.error(`${name} failed: ${error}`);
  } else {
    console.log(`${name} ok`);
  }
}
if (failed) process.exit(1);
