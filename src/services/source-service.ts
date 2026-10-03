import type { IngestionRequest } from '../domain/source-input.ts';
import { isSourceId, SourceError, sourceVersionKey } from '../domain/source.ts';
import type { NormalizedDocument, SourceVersion } from '../domain/source.ts';
import type { SourceInputReader } from '../ports/source-input-reader.ts';
import type { SourceParser } from '../ports/source-parser.ts';
import type { SourceRepository, IngestionResult } from '../ports/source-repository.ts';
import type { CourseService } from './course-service.ts';

export class SourceService {
  private readonly courses: Pick<CourseService, 'getCourse'>;
  private readonly repository: SourceRepository;
  private readonly reader: SourceInputReader;
  private readonly parsers: readonly SourceParser[];
  private readonly hash: (bytes: Uint8Array) => string;
  private readonly generateId: () => string;
  constructor(courses: Pick<CourseService, 'getCourse'>, repository: SourceRepository,
    reader: SourceInputReader, parsers: readonly SourceParser[], hash: (bytes: Uint8Array) => string,
    generateId: () => string) {
    this.courses = courses; this.repository = repository; this.reader = reader;
    this.parsers = parsers; this.hash = hash; this.generateId = generateId;
  }
  async ingest(courseId: string, request: IngestionRequest): Promise<IngestionResult> {
    this.courses.getCourse(courseId);
    if (!request.location.trim()) throw new SourceError('invalid-input', 'Supply a source path or URL.');
    const input = await this.reader.read(request);
    if (!input.identityKey.trim()) throw new SourceError('invalid-input', 'Source identity cannot be empty.');
    const parser = this.parsers.find((candidate) => candidate.supports(input));
    if (!parser) throw new SourceError('unsupported', `Unsupported source type: ${input.kind}.`);
    const contentHash = this.hash(input.bytes);
    if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new SourceError('invalid-input', 'Hasher must return SHA-256.');
    let document: NormalizedDocument;
    try { document = await parser.parse(input); }
    catch {
      // Avoid exposing parser errors that may contain private source text or credentials.
      document = { title: input.title, status: 'failed', parser: `${input.kind}:failed`,
        warnings: [{ code: 'parse_failed', message: 'Extraction failed; no usable content was indexed.' }],
        metadata: {}, segments: [] };
    }
    this.validateDocument(input.kind, document);
    const proposedId = this.generateId();
    if (!isSourceId(proposedId)) throw new SourceError('invalid-input', 'Invalid generated source ID.');
    return this.storage(() => this.repository.save({ proposedId, courseId, identityKey: input.identityKey,
      kind: input.kind, origin: input.origin, location: input.location, ingestedAt: input.retrievedAt,
      contentHash, document: { ...document, metadata: { ...document.metadata,
        requestedLocation: input.requestedLocation, retrievedAt: input.retrievedAt,
        ...(input.captionsLocation ? { captionsLocation: input.captionsLocation } : {}) } } }));
  }
  list(courseId: string) {
    this.courses.getCourse(courseId);
    return this.storage(() => this.repository.list(courseId));
  }
  status(courseId: string, sourceId: string, version?: number): SourceVersion {
    this.courses.getCourse(courseId);
    this.validateSourceId(sourceId);
    const source = this.storage(() => this.repository.get(courseId, sourceId));
    if (!source) throw new SourceError('not-found', 'Source not found in the active course.');
    const selected = version ?? source.currentVersion;
    sourceVersionKey(sourceId, selected);
    const result = this.storage(() => this.repository.getVersion(courseId, sourceId, selected));
    if (!result) throw new SourceError('not-found', 'Source version not found.');
    return result;
  }
  search(courseId: string, query: string, options: { sourceId?: string; limit?: number } = {}) {
    this.courses.getCourse(courseId);
    if (query.length > 1000) throw new SourceError('invalid-input', 'Search query is too long.');
    const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const symbols = [...new Set(query.match(/\p{S}/gu) ?? [])];
    if ((!words.length && !symbols.length) || words.length + symbols.length > 32) {
      throw new SourceError('invalid-input', 'Search needs 1–32 word/symbol components.');
    }
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new SourceError('invalid-input', 'Search limit must be 1–50.');
    if (options.sourceId) this.status(courseId, options.sourceId);
    // Literal words joined with AND: source data cannot inject FTS operators or SQL.
    return this.storage(() => this.repository.search(courseId,
      words.length ? words.map((word) => `"${word}"`).join(' AND ') : undefined,
      limit, options.sourceId, symbols));
  }
  private validateSourceId(id: string): void {
    if (!isSourceId(id)) throw new SourceError('invalid-input', 'Expected source-<UUID v4>.');
  }
  private validateDocument(kind: string, document: NormalizedDocument): void {
    if (!document.title.trim() || !document.parser || !['ready', 'ready_with_warnings',
      'extraction_incomplete', 'failed', 'transcript_unavailable'].includes(document.status)
      || ((document.status === 'ready' || document.status === 'ready_with_warnings') && !document.segments.some((s) => s.text.trim()))) {
      throw new SourceError('invalid-input', 'Parser returned an invalid extraction document.');
    }
    document.segments.forEach((segment, index) => {
      const anchor = segment.anchor;
      const valid = anchor.kind === kind && segment.order === index && (
        anchor.kind === 'pdf' ? Number.isSafeInteger(anchor.page) && anchor.page > 0 :
        anchor.kind === 'pptx' ? Number.isSafeInteger(anchor.slide) && anchor.slide > 0 && ['slide', 'notes'].includes(anchor.part) :
        anchor.kind === 'youtube' ? Number.isFinite(anchor.startSeconds) && Number.isFinite(anchor.endSeconds)
          && anchor.startSeconds >= 0 && anchor.endSeconds >= anchor.startSeconds :
        Number.isSafeInteger(anchor.startOffset) && Number.isSafeInteger(anchor.endOffset)
          && anchor.startOffset >= 0 && anchor.endOffset >= anchor.startOffset
          && (anchor.kind === 'text' || (Number.isSafeInteger(anchor.section) && anchor.section >= 0)));
      if (!valid) throw new SourceError('invalid-input', 'Parser returned invalid segment order/anchors.');
    });
    if ((document.status === 'failed' || document.status === 'transcript_unavailable') && document.segments.length) {
      throw new SourceError('invalid-input', 'Failed/unavailable extraction must not contain indexed segments.');
    }
  }
  private storage<T>(operation: () => T): T {
    try { return operation(); }
    catch (cause) { throw new SourceError('storage', 'Source storage could not complete the operation.', { cause }); }
  }
}
