import { recoveryPlan } from "./job-recovery";

describe("recoveryPlan", () => {
  it("requeues a job the worker no longer holds", () => {
    expect(recoveryPlan("DOWNLOADING", false)).toBe("requeue");
    expect(recoveryPlan("QUEUED", false)).toBe("requeue");
  });

  it("leaves a job Redis will still run", () => {
    expect(recoveryPlan("FETCHING_INFO", true)).toBe("skip");
  });

  it("ignores finished jobs", () => {
    expect(recoveryPlan("COMPLETED", false)).toBe("skip");
    expect(recoveryPlan("FAILED", false)).toBe("skip");
  });
});
