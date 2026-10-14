export const ACTIVE_JOB_STATUSES = ["QUEUED", "FETCHING_INFO", "DOWNLOADING", "CONVERTING"] as const;

/**
 * A job Redis still holds will be run by the worker. Anything else that was
 * left mid-flight is queued again so a restart resumes it from the database.
 */
export function recoveryPlan(status: string, stillQueued: boolean): "skip" | "requeue" {
  if (!(ACTIVE_JOB_STATUSES as readonly string[]).includes(status)) return "skip";
  if (stillQueued) return "skip";
  return "requeue";
}
