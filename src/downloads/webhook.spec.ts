import { signWebhook, webhookSignatureMatches } from "./webhook";

describe("webhook signatures", () => {
  it("signs the raw body and checks the header in constant time", () => {
    const body = JSON.stringify({ id: "job", status: "COMPLETED" });
    const sig = signWebhook(body, "secret");
    expect(webhookSignatureMatches(body, `sha256=${sig}`, "secret")).toBe(true);
    expect(webhookSignatureMatches(body, `sha256=${sig}`, "other")).toBe(false);
    expect(webhookSignatureMatches(`${body} `, `sha256=${sig}`, "secret")).toBe(false);
  });
});