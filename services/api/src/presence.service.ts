// services/api/src/presence.service.ts
// Counts open SSE connections so the UI can say "somebody else is experimenting
// right now" (spec 3). There is one world, not one per visitor — that line turns
// the shared state from a caveat into evidence that the switches are real.
import { Injectable } from '@nestjs/common';

@Injectable()
export class PresenceService {
  private viewers = 0;
  private readonly listeners = new Set<(count: number) => void>();

  join(): () => void {
    this.viewers += 1;
    this.publish();
    return () => { this.viewers -= 1; this.publish(); };
  }

  count(): number { return this.viewers; }

  onChange(listener: (count: number) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.viewers);
  }
}
