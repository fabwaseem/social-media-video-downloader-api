import { ErrorCode } from "../../common/errors";
import { classifyYtdlpFailure } from "./errors";

describe("classifyYtdlpFailure", () => {
  const cases: Array<[string, ErrorCode, number]> = [
    ["ERROR: Sign in to confirm you’re not a bot", ErrorCode.BLOCKED, 403],
    ["ERROR: Private video", ErrorCode.PRIVATE, 403],
    ["ERROR: Video unavailable", ErrorCode.UNAVAILABLE, 404],
    ["ERROR: This video is not available in your country", ErrorCode.GEO_RESTRICTED, 451],
    ["ERROR: Login required", ErrorCode.LOGIN_REQUIRED, 401],
    ["ERROR: Unsupported URL: https://example.com/x", ErrorCode.UNSUPPORTED, 400],
  ];

  it.each(cases)("%s -> %s", (raw, code, status) => {
    const failure = classifyYtdlpFailure(raw);
    expect(failure.code).toBe(code);
    expect(failure.status).toBe(status);
    expect(failure.message.length).toBeGreaterThan(0);
  });
});
