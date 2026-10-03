import type { NormalizedDocument, Source, SourceOrigin, SourceKind, SourceSearchResult, SourceVersion } from '../domain/source.ts';

export interface SaveSourceVersion {
  readonly proposedId: string;
  readonly courseId: string;
  readonly identityKey: string;
  readonly kind: SourceKind;
  readonly origin: SourceOrigin;
  readonly location: string;
  readonly ingestedAt: string;
  readonly contentHash: string;
  readonly document: NormalizedDocument;
}
export interface IngestionResult {
  readonly source: Source;
  readonly version: SourceVersion;
  readonly unchanged: boolean;
}
export interface SourceRepository {
  save(input: SaveSourceVersion): IngestionResult;
  list(courseId: string): Source[];
  get(courseId: string, sourceId: string): Source | undefined;
  getVersion(courseId: string, sourceId: string, version: number): SourceVersion | undefined;
  search(courseId: string, match: string | undefined, limit: number, sourceId?: string,
    symbols?: readonly string[]): SourceSearchResult[];
}
