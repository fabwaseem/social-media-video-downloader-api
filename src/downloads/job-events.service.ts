import { Injectable } from "@nestjs/common";
import type { JobEvent } from "@vidyoza/shared";
import { Observable, ReplaySubject } from "rxjs";

/**
 * Per-job event channels backing the SSE endpoint. A ReplaySubject(1) makes
 * sure a client that connects mid-download immediately receives the latest
 * progress frame.
 */
@Injectable()
export class JobEventsService {
  private readonly channels = new Map<string, ReplaySubject<JobEvent>>();

  private channel(jobId: string): ReplaySubject<JobEvent> {
    let subject = this.channels.get(jobId);
    if (!subject) {
      subject = new ReplaySubject<JobEvent>(1);
      this.channels.set(jobId, subject);
    }
    return subject;
  }

  emit(jobId: string, event: JobEvent): void {
    this.channel(jobId).next(event);
  }

  /** Emits a terminal event and closes the stream shortly after. */
  finish(jobId: string, event: JobEvent): void {
    const subject = this.channel(jobId);
    subject.next(event);
    subject.complete();
    // Keep the completed subject briefly so late subscribers still get the
    // terminal frame, then free memory.
    setTimeout(() => this.channels.delete(jobId), 5 * 60 * 1000).unref?.();
  }

  stream(jobId: string): Observable<JobEvent> {
    return this.channel(jobId).asObservable();
  }

  has(jobId: string): boolean {
    return this.channels.has(jobId);
  }
}
