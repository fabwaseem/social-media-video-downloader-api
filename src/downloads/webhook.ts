import { createHmac, timingSafeEqual } from "crypto";
import { fetchGuarded } from "../common/http/safe-fetch";

export function signWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function webhookSignatureMatches(body: string, header: string, secret: string): boolean {
  const expected = `sha256=${signWebhook(body, secret)}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** POSTs a JSON body to a public callback. Private hosts are refused. */
export async function postWebhook(url: string, payload: unknown, secret: string): Promise<void> {
  const body = JSON.stringify(payload);
  const response = await fetchGuarded(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-downloader-signature": `sha256=${signWebhook(body, secret)}`,
    },
    body,
    timeoutMs: 10_000,
    maxRedirects: 2,
    maxBytes: 1024 * 1024,
  });
  response.body.resume();
}
