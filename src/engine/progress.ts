/** yt-dlp --progress-template producing easily parseable lines. */
export const PROGRESS_TEMPLATE =
  "VZPROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";

export interface EngineProgress {
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
  percentage: number;
}

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Parses a VZPROG line; returns null for unrelated output. */
export function parseProgressLine(line: string): EngineProgress | null {
  const idx = line.indexOf("VZPROG|");
  if (idx === -1) return null;
  const parts = line.slice(idx).trim().split("|");
  if (parts.length < 6) return null;

  const downloadedBytes = num(parts[1]);
  const totalBytes = num(parts[2]) || num(parts[3]);
  const speed = num(parts[4]);
  const eta = num(parts[5]);
  const percentage =
    totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10) : 0;

  return { downloadedBytes, totalBytes, speed, eta, percentage };
}

/**
 * Merges yt-dlp's per-stream progress into one bar.
 *
 * A muxed video download is two sequential passes — video, then audio — and
 * yt-dlp reports each from 0 to 100%. Forwarded verbatim that reads as the
 * download restarting: the bar fills, snaps back to zero, then fills again.
 *
 * We carry finished passes forward so bytes accumulate across the whole job,
 * and hold the bar monotonic so it never travels backwards. The percentage
 * stops just short of 100 while the process is alive, because the last pass
 * completing is not the job completing — the merge still has to run. The
 * caller reports the true 100% on the completion event.
 */
export class ProgressAggregator {
  private priorBytes = 0;
  private priorTotal = 0;
  private lastBytes = 0;
  private lastTotal = 0;
  private peak = 0;

  push(p: EngineProgress): EngineProgress {
    // A pass restarting is the only way downloaded bytes decrease; bank the
    // one that just finished before folding the new sample in.
    if (p.downloadedBytes < this.lastBytes) {
      const finished = Math.max(this.lastTotal, this.lastBytes);
      this.priorBytes += finished;
      this.priorTotal += finished;
    }
    this.lastBytes = p.downloadedBytes;
    this.lastTotal = p.totalBytes;

    const downloadedBytes = this.priorBytes + p.downloadedBytes;
    const totalBytes = this.priorTotal + p.totalBytes;
    const raw = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

    this.peak = Math.max(this.peak, Math.min(raw, 99.9));
    return {
      downloadedBytes,
      totalBytes,
      speed: p.speed,
      eta: p.eta,
      percentage: Math.round(this.peak * 10) / 10,
    };
  }
}
