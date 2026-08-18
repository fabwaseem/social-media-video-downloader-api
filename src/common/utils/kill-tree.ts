import { execFile } from "child_process";
import type { ChildProcess } from "child_process";

/**
 * POSIX children are spawned as process-group leaders so `killTree` has a group
 * to signal. Windows has no process groups; `killTree` walks the tree instead.
 */
export const DETACH_CHILDREN = process.platform !== "win32";

/**
 * Terminates a child process and everything it spawned.
 *
 * `child.kill()` signals only the process we hold a handle to, which is not the
 * one doing the work: the standalone yt-dlp build is a PyInstaller bundle whose
 * entry process immediately launches the real downloader as a separate child.
 * Signalling the launcher leaves that worker running — it keeps saturating the
 * connection, keeps growing its `.part` file, and outlives the API process
 * entirely. A cancelled download has to take the worker with it.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;
  if (!pid || hasExited(child)) return;

  if (process.platform === "win32") {
    // /T walks the tree, /F is forceful — Windows offers no graceful signal a
    // console process would honour anyway. Failures are expected and ignored:
    // the usual one is the tree having already exited between check and call.
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }

  try {
    // Negative pid = the whole process group, which is why we detach on spawn.
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/** True once the process has actually terminated (not merely been signalled). */
export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
