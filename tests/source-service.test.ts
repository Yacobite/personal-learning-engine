import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CourseService } from '../src/services/course-service.ts';
import { SourceService } from '../src/services/source-service.ts';
import { SqliteCourseRepository } from '../src/persistence/course-repository.ts';
import { SqliteSourceRepository } from '../src/persistence/source-repository.ts';
import { applyMigrations } from '../src/persistence/migrations.ts';
import { TextParser } from '../src/ingestion/text-parser.ts';
import { input } from './helpers/source-fixtures.ts';
import type { SourceParser } from '../src/ports/source-parser.ts';
import type { SourceRepository } from '../src/ports/source-repository.ts';
import { SourceError } from '../src/domain/source.ts';

function harness(parsers: readonly SourceParser[] = [new TextParser()]) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON'); applyMigrations(database);
  const courses = new CourseService(new SqliteCourseRepository(database), () => `course-${randomUUID()}`, () => new Date());
  const course = courses.createCourse({ title: 'Logic', mode: 'source_grounded', objective: 'Study' });
  let prepared = input('text', 'implication first edition');
  const repository = new SqliteSourceRepository(database);
  const service = new SourceService(courses, repository, { read: async () => prepared }, parsers,
    (bytes) => createHash('sha256').update(bytes).digest('hex'), () => `source-${randomUUID()}`);
  return { database, courses, course, repository, service, set: (next: typeof prepared) => { prepared = next; } };
}
test('ingestion chooses a supporting parser, associates course, deduplicates hashes and preserves changed versions', async () => {
  let skipped = 0;
  const h = harness([{ supports: () => false, parse: async () => { skipped++; throw new Error('wrong parser'); } }, new TextParser()]);
  try {
    const first = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(first.source.courseId, h.course.id);
    assert.equal(first.version.version, 1);
    assert.equal(first.unchanged, false);
    assert.equal(skipped, 0);
    const same = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(same.source.id, first.source.id);
    assert.equal(same.version.version, 1);
    assert.equal(same.unchanged, true);
    h.set(input('text', 'equivalence second edition'));
    const changed = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(changed.source.id, first.source.id);
    assert.equal(changed.version.version, 2);
    assert.equal(h.service.status(h.course.id, first.source.id, 1).segments[0]!.text, 'implication first edition');
    assert.equal(h.service.search(h.course.id, 'implication').length, 0, 'search current versions only');
    assert.equal(h.service.search(h.course.id, 'equivalence').length, 1);
    h.set(input('text', 'implication first edition'));
    const restored = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(restored.version.version, 1);
    assert.equal(restored.unchanged, true);
    assert.equal(h.service.status(h.course.id, first.source.id, 2).version, 2);
    assert.equal(h.database.prepare('SELECT COUNT(*) AS count FROM source_versions').get()?.count, 2);
  } finally { h.database.close(); }
});
test('parse failure persists failed status with no FTS content; unsupported types and missing course fail clearly', async () => {
  const h = harness([{ supports: () => true, parse: async () => { throw new Error('private content'); } }]);
  try {
    const result = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(result.version.status, 'failed');
    assert.deepEqual(result.version.segments, []);
    assert.equal(h.service.search(h.course.id, 'implication').length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private content/);
    await assert.rejects(h.service.ingest('course-00000000-0000-4000-8000-000000000000', { location: 'fixture' }), /not found/);
    const unsupported = harness([]);
    try { await assert.rejects(unsupported.service.ingest(unsupported.course.id, { location: 'fixture' }), (e) => e instanceof SourceError && e.code === 'unsupported'); }
    finally { unsupported.database.close(); }
  } finally { h.database.close(); }
});
test('FTS returns full provenance, literal-word AND matches, source filters and no cross-course leakage', async () => {
  const h = harness();
  try {
    const first = await h.service.ingest(h.course.id, { location: 'fixture' });
    h.set(input('text', 'implication another source', { identityKey: 'fixture:second' }));
    const second = await h.service.ingest(h.course.id, { location: 'fixture' });
    const other = h.courses.createCourse({ title: 'Other', mode: 'hybrid', objective: 'Study' });
    await h.service.ingest(other.id, { location: 'fixture' });
    assert.equal(h.service.search(h.course.id, 'implication').length, 2);
    const filtered = h.service.search(h.course.id, 'implication', { sourceId: first.source.id });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.source.id, first.source.id);
    assert.equal(filtered[0]!.source.courseId, h.course.id);
    assert.equal(filtered[0]!.segment.version, 1);
    assert.equal(filtered[0]!.trust, 'untrusted-source-data');
    assert.ok(Number.isFinite(filtered[0]!.rank));
    assert.equal(filtered[0]!.segment.anchor.kind, 'text');
    assert.match(filtered[0]!.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(h.service.search(h.course.id, 'implication first').length, 1);
    assert.equal(h.service.search(h.course.id, '" OR secret').length, 0);
    assert.throws(() => h.service.search(h.course.id, '---'), /needs/);
    assert.throws(() => h.service.search(h.course.id, 'implication', { limit: 100 }), /limit/);
    assert.throws(() => h.service.status(other.id, second.source.id.replace(/.$/, '0')), /not found/);
  } finally { h.database.close(); }
});
test('storage rolls back source, version, segments and FTS together if indexing fails', async () => {
  const h = harness();
  try {
    h.set(input('text', 'implication '.repeat(900)));
    h.database.exec(`CREATE TRIGGER reject_segment BEFORE INSERT ON source_segments
      WHEN NEW.segment_order = 1
      BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    await assert.rejects(h.service.ingest(h.course.id, { location: 'fixture' }), (e) => e instanceof SourceError && e.code === 'storage');
    for (const table of ['sources', 'source_versions', 'source_segments', 'source_segments_fts']) {
      assert.equal(h.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
    }
    h.database.exec('DROP TRIGGER reject_segment');
    h.set(input('text', 'implication original'));
    const original = await h.service.ingest(h.course.id, { location: 'fixture' });
    h.database.exec(`CREATE TRIGGER reject_version BEFORE INSERT ON source_versions
      WHEN NEW.version = 2 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    h.set(input('text', 'equivalence changed'));
    await assert.rejects(h.service.ingest(h.course.id, { location: 'fixture' }), /storage/);
    assert.equal(h.service.status(h.course.id, original.source.id).version, 1);
    assert.equal(h.service.search(h.course.id, 'implication').length, 1);
    assert.equal(h.service.search(h.course.id, 'equivalence').length, 0);
  } finally { h.database.close(); }
});
test('symbol-only and mixed Logic searches keep operators, provenance, course/source scope and current versions', async (t) => {
  const h = harness();
  try {
    h.set(input('text', '¬P; P ∧ Q; P ∨ Q; P → Q; P ↔ Q; P ⊨ Q; P ⊢ Q; α × β'));
    const logic = await h.service.ingest(h.course.id, { location: 'fixture' });
    h.set(input('text', 'P Q word-only distractor', { identityKey: 'fixture:words' }));
    const words = await h.service.ingest(h.course.id, { location: 'fixture' });
    h.set(input('text', 'P ⊨ Q entailment distractor', { identityKey: 'fixture:entailment' }));
    await h.service.ingest(h.course.id, { location: 'fixture' });
    const other = h.courses.createCourse({ title: 'Other', mode: 'hybrid', objective: 'Study' });
    h.set(input('text', '¬P; P → Q; P ⊨ Q; P ⊢ Q', { identityKey: 'fixture:other' }));
    await h.service.ingest(other.id, { location: 'fixture' });
    for (const symbol of ['¬', '∧', '∨', '→', '↔', '⊨', '⊢', '×']) {
      const results = h.service.search(h.course.id, symbol);
      assert.ok(results.length, symbol);
      assert.ok(results.every((r) => r.segment.text.includes(symbol) && r.source.courseId === h.course.id
        && r.segment.version === r.source.currentVersion && r.trust === 'untrusted-source-data'
        && r.segment.anchor.kind === 'text' && !!r.location && !!r.contentHash && r.rank === 0));
      assert.deepEqual(h.service.search(h.course.id, symbol), results, 'literal fallback order is stable');
      assert.equal(h.service.search(h.course.id, symbol, { sourceId: words.source.id }).length, 0);
      t.diagnostic(`${symbol}: retrieved ${results.length} current-course segment(s)`);
    }
    const mixed = h.service.search(h.course.id, 'P → Q');
    assert.deepEqual(mixed.map((r) => r.source.id), [logic.source.id], 'word-only and different-operator text must not match');
    assert.ok(mixed[0]!.segment.text.includes('→'));
    assert.ok(mixed[0]!.rank < 0, 'mixed searches retain FTS/BM25');
    t.diagnostic('P → Q: retrieved implication source only; operator retained');
    assert.equal(h.service.search(h.course.id, 'P ⊨ Q').length, 2);
    assert.equal(h.service.search(h.course.id, 'P → ⊨ Q', { sourceId: logic.source.id }).length, 1);
    assert.equal(h.service.search(h.course.id, 'P → Q" OR "secret').length, 0, 'FTS operators stay literal words');
    assert.equal(h.service.search(h.course.id, "→ '); DROP TABLE sources; --").length, 0, 'query cannot inject SQL');
    h.set(input('text', 'P Q changed without operators'));
    const changed = await h.service.ingest(h.course.id, { location: 'fixture' });
    assert.equal(changed.source.id, logic.source.id);
    assert.equal(changed.version.version, 2);
    assert.equal(h.service.search(h.course.id, '→').length, 0, 'old symbols are excluded after update');
    assert.equal(h.service.search(h.course.id, 'P → Q').length, 0);
    assert.ok(h.service.status(h.course.id, logic.source.id, 1).segments[0]!.text.includes('→'));
  } finally { h.database.close(); }
});
test('empty logical identities are rejected by the service before parsing or persistence', async () => {
  const h = harness();
  try {
    h.set(input('text', 'Logic', { identityKey: '  \n\t' }));
    await assert.rejects(h.service.ingest(h.course.id, { location: 'fixture' }), /identity cannot be empty/);
    assert.deepEqual(h.service.list(h.course.id), []);
  } finally { h.database.close(); }
});
test('service operates with fake ports and rejects invalid normalized anchors before persistence', async () => {
  let saved = false;
  const repository: SourceRepository = { save: () => { saved = true; throw new Error('must not save'); },
    list: () => [], get: () => undefined, getVersion: () => undefined, search: () => [] };
  const h = harness();
  try {
    const parser: SourceParser = { supports: () => true, parse: async () => ({ title: 'Fixture', status: 'ready', parser: 'fake',
      warnings: [], metadata: {}, segments: [{ order: 9, text: 'bad', anchor: { kind: 'pdf', page: 0 }, headingPath: [], visualRefs: [] }] }) };
    const service = new SourceService(h.courses, repository, { read: async () => input('text', 'fixture') }, [parser],
      () => 'a'.repeat(64), () => `source-${randomUUID()}`);
    await assert.rejects(service.ingest(h.course.id, { location: 'fixture' }), /invalid segment/);
    assert.equal(saved, false);
    assert.deepEqual(service.list(h.course.id), []);
  } finally { h.database.close(); }
});
