import { LruTtlCache } from "./media-cache";

describe("LruTtlCache", () => {
  it("expires entries and evicts the oldest key when full", () => {
    const cache = new LruTtlCache<string>(2);
    cache.set("a", "one", 1_000, 0);
    cache.set("b", "two", 1_000, 0);
    expect(cache.get("a", 10)).toBe("one");
    cache.set("c", "three", 1_000, 10);
    expect(cache.get("b", 10)).toBeUndefined();
    expect(cache.get("a", 2_000)).toBeUndefined();
  });
});
