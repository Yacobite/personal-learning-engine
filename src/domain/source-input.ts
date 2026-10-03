import type { SourceKind, SourceOrigin } from './source.ts';

export interface IngestionRequest {
  readonly location: string;
  readonly captionsPath?: string;
}
/** Prepared bytes are data; reading/fetching is an adapter responsibility. */
export interface SourceInput {
  readonly kind: SourceKind;
  readonly identityKey: string;
  readonly location: string;
  readonly requestedLocation: string;
  readonly title: string;
  readonly origin: SourceOrigin;
  readonly bytes: Uint8Array;
  readonly retrievedAt: string;
  readonly videoId?: string;
  readonly captionsLocation?: string;
}
