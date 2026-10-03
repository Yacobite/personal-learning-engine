import type { FoundationStatus } from '../domain/foundation-status.ts';
import type { FoundationStore } from '../ports/foundation-store.ts';

export class FoundationService {
  private readonly store: FoundationStore;

  constructor(store: FoundationStore) {
    this.store = store;
  }

  getStatus(): FoundationStatus {
    return this.store.readStatus();
  }
}
