import { createHash } from "crypto";
import { createWriteStream } from "fs";
import * as fsSync from "fs";
import * as fs from "fs/promises";
import { pipeline } from "stream/promises";
import { safeFetch } from "../../common/http/safe-fetch";

/** Downloads a public release asset and checks its sha256 when one is known. */
export async function downloadVerifiedFile(fileUrl: string, savePath: string, sha256?: string): Promise<void> {
  const cleanup = () => {
    if (fsSync.existsSync(savePath)) fsSync.unlinkSync(savePath);
  };
  const response = await safeFetch(fileUrl, { timeoutMs: 120_000, maxBytes: 400 * 1024 * 1024 });
  if (response.status !== 200) {
    response.body.resume();
    throw new Error(`Download failed with status ${response.status}`);
  }
  try {
    await pipeline(response.body, createWriteStream(savePath));
  } catch (error) {
    cleanup();
    throw error;
  }
  if (!sha256) return;
  const actual = createHash("sha256").update(await fs.readFile(savePath)).digest("hex");
  if (actual !== sha256) {
    cleanup();
    throw new Error(`Checksum mismatch for ${fileUrl}`);
  }
}
