import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { systemFixture } from './system-fixtures.ts';
import { CanonicalObsidianReader } from '../../src/services/obsidian-projection-reader.ts';
import { ObsidianExportService } from '../../src/exports/obsidian/obsidian-export-service.ts';
import type { VaultIO } from '../../src/exports/obsidian/obsidian-paths.ts';
import type { Course } from '../../src/domain/course.ts';
import { markers } from '../../src/exports/obsidian/obsidian-notes.ts';
import { TeachingContextBuilder } from '../../src/services/teaching-context.ts';
export function projectionReader(r: Awaited<ReturnType<typeof systemFixture>>['runtime'], clock: () => Date) { return new CanonicalObsidianReader(r.store, new TeachingContextBuilder(r.store.sources, r.store.research), fn => r.store.readSnapshot(fn), clock); }
export async function obsidianFixture(mode: Course['mode'] = 'source_grounded', io?: VaultIO) {
    const f = await systemFixture(mode), reader = projectionReader(f.runtime, f.clock), exports = new ObsidianExportService(f.root, reader, f.clock, io);
    return { ...f, reader, exports };
}
export function dbRows(root: string) { const db = new DatabaseSync(join(root, '_learning', 'learning.db'), { readOnly: true }); try {
    return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => [row.name, db.prepare('SELECT * FROM "' + String(row.name).replaceAll('"', '""') + '"').all()]));
}
finally {
    db.close();
} }
export function setUser(path: string, bytes: Buffer) { const b = readFileSync(path), start = b.indexOf(markers.us) + Buffer.byteLength(markers.us), end = b.indexOf(markers.ue); writeFileSync(path, Buffer.concat([b.subarray(0, start), bytes, b.subarray(end)])); }
export function userBytes(path: string) { const b = readFileSync(path), start = b.indexOf(markers.us) + Buffer.byteLength(markers.us), end = b.indexOf(markers.ue); return b.subarray(start, end); }
export function noteFiles(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() && !e.name.startsWith('.') ? noteFiles(join(root, e.name)) : e.name.endsWith('.md') ? [join(root, e.name)] : []); }
export function fileState(root: string) { return noteFiles(root).map(p => ({ path: p, bytes: readFileSync(p), time: statSync(p, { bigint: true }).mtimeNs })); }
export const fakeStudy = { propose: async (c: import('../../src/ports/diagnostic-generator.ts').DiagnosticTaskContext) => ({ coreIdea: 'SYNTHETIC grounded explanation. α → β; no claim of learner mastery.', keyPoints: ['SYNTHETIC source-grounded study.'], selfCheckPrompts: ['SYNTHETIC private self-check: what is the definition?'], sourceRefs: c.source.map(s => s.ref), researchRefs: c.research.map(r => r.ref) }) };
