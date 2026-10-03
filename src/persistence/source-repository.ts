import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Source, SourceSegment, SourceVersion, SourceSearchResult } from '../domain/source.ts';
import { sourceVersionKey } from '../domain/source.ts';
import type { SaveSourceVersion, SourceRepository, IngestionResult } from '../ports/source-repository.ts';

type Row = Record<string, SQLOutputValue>;
function source(row: Row): Source {
  return { id: String(row.id), courseId: String(row.course_id), identityKey: String(row.identity_key),
    kind: String(row.kind) as Source['kind'], title: String(row.title), origin: String(row.origin) as Source['origin'],
    currentVersion: Number(row.current_version), status: String(row.status) as Source['status'],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function segment(row: Row): SourceSegment {
  return { id: String(row.id), sourceId: String(row.source_id), version: Number(row.version),
    order: Number(row.segment_order), text: String(row.text),
    headingPath: JSON.parse(String(row.heading_path_json)) as SourceSegment['headingPath'],
    anchor: JSON.parse(String(row.anchor_json)) as SourceSegment['anchor'],
    visualRefs: JSON.parse(String(row.visual_refs_json)) as SourceSegment['visualRefs'] };
}
function version(row: Row, segments: SourceSegment[]): SourceVersion {
  return { sourceId: String(row.source_id), version: Number(row.version), contentHash: String(row.content_hash),
    location: String(row.location), ingestedAt: String(row.ingested_at), origin: String(row.origin) as SourceVersion['origin'],
    title: String(row.title), status: String(row.status) as SourceVersion['status'], parser: String(row.parser),
    warnings: JSON.parse(String(row.warnings_json)) as SourceVersion['warnings'],
    metadata: JSON.parse(String(row.metadata_json)) as SourceVersion['metadata'], segments };
}
export class SqliteSourceRepository implements SourceRepository {
  private readonly database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database = database; }
  save(input: SaveSourceVersion): IngestionResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = this.database.prepare('SELECT * FROM sources WHERE course_id = ? AND identity_key = ?')
        .get(input.courseId, input.identityKey);
      const existing = existingRow ? source(existingRow) : undefined;
      if (existing && (existing.kind !== input.kind || existing.origin !== input.origin)) throw new Error('Source identity classification changed');
      const id = existing?.id ?? input.proposedId;
      const same = this.database.prepare('SELECT * FROM source_versions WHERE source_id = ? AND content_hash = ?')
        .get(id, input.contentHash);
      const next = same ? Number(same.version) : Number(this.database.prepare(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM source_versions WHERE source_id = ?',
      ).get(id)?.next);
      const document = same ? version(same, this.segments(id, next)) : input.document;
      if (!existing) this.database.prepare(`INSERT INTO sources
        (id, course_id, identity_key, kind, title, origin, current_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.courseId, input.identityKey, input.kind,
        document.title, input.origin, next, document.status, input.ingestedAt, input.ingestedAt);
      if (!same) {
        this.database.prepare(`INSERT INTO source_versions
          (source_id, version, content_hash, location, ingested_at, origin, title, status, parser, warnings_json, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, next, input.contentHash, input.location,
          input.ingestedAt, input.origin, document.title, document.status, document.parser,
          JSON.stringify(document.warnings), JSON.stringify(document.metadata));
        const insert = this.database.prepare(`INSERT INTO source_segments
          (id, source_id, version, segment_order, text, heading_path_json, anchor_json, visual_refs_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const index = this.database.prepare('INSERT INTO source_segments_fts (text, segment_id) VALUES (?, ?)');
        for (const part of document.segments) {
          const segmentId = `${sourceVersionKey(id, next)}:${part.order}`;
          insert.run(segmentId, id, next, part.order, part.text, JSON.stringify(part.headingPath),
            JSON.stringify(part.anchor), JSON.stringify(part.visualRefs));
          index.run(part.text, segmentId);
        }
      }
      if (existing && existing.currentVersion !== next) this.database.prepare(
        'UPDATE sources SET current_version = ?, title = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(next, document.title, document.status, input.ingestedAt, id);
      const saved = this.get(input.courseId, id)!;
      const savedVersion = this.getVersion(input.courseId, id, next)!;
      this.database.exec('COMMIT');
      return { source: saved, version: savedVersion, unchanged: !!same };
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  list(courseId: string): Source[] {
    return this.database.prepare('SELECT * FROM sources WHERE course_id = ? ORDER BY created_at, id').all(courseId).map(source);
  }
  get(courseId: string, sourceId: string): Source | undefined {
    const row = this.database.prepare('SELECT * FROM sources WHERE course_id = ? AND id = ?').get(courseId, sourceId);
    return row ? source(row) : undefined;
  }
  getVersion(courseId: string, sourceId: string, number: number): SourceVersion | undefined {
    const row = this.database.prepare(`SELECT v.* FROM source_versions v JOIN sources s ON s.id = v.source_id
      WHERE s.course_id = ? AND v.source_id = ? AND v.version = ?`).get(courseId, sourceId, number);
    return row ? version(row, this.segments(sourceId, number)) : undefined;
  }
  search(courseId: string, match: string | undefined, limit: number, sourceId?: string,
    symbols: readonly string[] = []): SourceSearchResult[] {
    const literalSymbols = JSON.stringify(symbols);
    const rows = match ? this.database.prepare(`SELECT p.*, bm25(source_segments_fts) AS rank, v.location, v.content_hash
      FROM source_segments_fts
      JOIN source_segments p ON p.id = source_segments_fts.segment_id
      JOIN sources s ON s.id = p.source_id AND s.current_version = p.version
      JOIN source_versions v ON v.source_id = p.source_id AND v.version = p.version
      WHERE source_segments_fts MATCH ? AND s.course_id = ? AND (? IS NULL OR s.id = ?)
        AND NOT EXISTS (SELECT 1 FROM json_each(?) symbol WHERE instr(p.text, symbol.value) = 0)
      ORDER BY rank, s.id, p.segment_order LIMIT ?`).all(match, courseId, sourceId ?? null, sourceId ?? null, literalSymbols, limit)
      : this.database.prepare(`SELECT p.*, 0.0 AS rank, v.location, v.content_hash
        FROM source_segments p
        JOIN sources s ON s.id = p.source_id AND s.current_version = p.version
        JOIN source_versions v ON v.source_id = p.source_id AND v.version = p.version
        WHERE s.course_id = ? AND (? IS NULL OR s.id = ?)
          AND NOT EXISTS (SELECT 1 FROM json_each(?) symbol WHERE instr(p.text, symbol.value) = 0)
        ORDER BY s.id, p.segment_order LIMIT ?`).all(courseId, sourceId ?? null, sourceId ?? null, literalSymbols, limit);
    return rows.map((row) => ({ source: this.get(courseId, String(row.source_id))!, segment: segment(row),
      rank: Number(row.rank), location: String(row.location), contentHash: String(row.content_hash),
      trust: 'untrusted-source-data' }));
  }
  private segments(sourceId: string, number: number): SourceSegment[] {
    return this.database.prepare('SELECT * FROM source_segments WHERE source_id = ? AND version = ? ORDER BY segment_order')
      .all(sourceId, number).map(segment);
  }
}
