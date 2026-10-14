import { MemoryRateLimitStore } from "./rate-limit.store";

describe("MemoryRateLimitStore", () => {
  it("counts calls inside the window and rejects the one past the limit", () => {
    const store = new MemoryRateLimitStore();
    const now = 1_000_000;
    expect(store.consume("key", 2, now)).toBe(1);
    expect(store.consume("key", 2, now + 10)).toBe(0);
    expect(store.consume("key", 2, now + 20)).toBe(-1);
  });

  it("forgets stamps once the minute has passed", () => {
    const store = new MemoryRateLimitStore();
    expect(store.consume("key", 1, 0)).toBe(0);
    expect(store.consume("key", 1, 60_001)).toBe(0);
  });
});
