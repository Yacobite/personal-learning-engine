export type SourceKind = 'pdf' | 'pptx' | 'markdown' | 'text' | 'web' | 'youtube';
export type ExtractionStatus = 'ready' | 'ready_with_warnings' | 'extraction_incomplete' | 'failed' | 'transcript_unavailable';
export type SourceOrigin = 'learner_file' | 'learner_url';

export type SourceAnchor =
  | { readonly kind: 'pdf'; readonly page: number }
  | { readonly kind: 'pptx'; readonly slide: number; readonly part: 'slide' | 'notes' }
  | { readonly kind: 'markdown' | 'web'; readonly section: number; readonly startOffset: number; readonly endOffset: number }
  | { readonly kind: 'text'; readonly startOffset: number; readonly endOffset: number }
  | { readonly kind: 'youtube'; readonly startSeconds: number; readonly endSeconds: number };

export interface ExtractionWarning {
  readonly code: string;
  readonly message: string;
  readonly anchor?: SourceAnchor;
}
export interface NormalizedSegment {
  readonly order: number;
  readonly text: string;
  readonly headingPath: readonly string[];
  readonly anchor: SourceAnchor;
  readonly visualRefs: readonly string[];
}
export interface NormalizedDocument {
  readonly title: string;
  readonly status: ExtractionStatus;
  readonly parser: string;
  readonly warnings: readonly ExtractionWarning[];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly segments: readonly NormalizedSegment[];
}
export interface Source {
  readonly id: string;
  readonly courseId: string;
  readonly identityKey: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly origin: SourceOrigin;
  readonly currentVersion: number;
  readonly status: ExtractionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface SourceVersion extends NormalizedDocument {
  readonly sourceId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly location: string;
  readonly ingestedAt: string;
  readonly origin: SourceOrigin;
}
export interface SourceSegment extends NormalizedSegment {
  readonly id: string;
  readonly sourceId: string;
  readonly version: number;
}
export interface SourceSearchResult {
  readonly source: Source;
  readonly segment: SourceSegment;
  readonly rank: number;
  readonly location: string;
  readonly contentHash: string;
  readonly trust: 'untrusted-source-data';
}
export class SourceError extends Error {
  readonly code: 'invalid-input' | 'unsupported' | 'not-found' | 'storage' | 'unsafe-path' | 'fetch';
  constructor(code: SourceError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceError';
    this.code = code;
  }
}
export function isSourceId(value: string): boolean {
  return /^source-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function sourceVersionKey(sourceId: string, version: number): string {
  if (!isSourceId(sourceId) || !Number.isSafeInteger(version) || version < 1) {
    throw new SourceError('invalid-input', 'Invalid source/version identity.');
  }
  return `${sourceId}@${version}`;
}
