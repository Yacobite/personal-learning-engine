import type { FoundationStatus } from '../domain/foundation-status.ts';

export interface FoundationStore {
  readStatus(): FoundationStatus;
}
