import { ObsidianError, obsidianFormat } from '../../domain/obsidian.ts';
import type { StudyMaterial } from '../../domain/obsidian.ts';
import { SafeVault, readableName } from './obsidian-paths.ts';
import { parseNote, decode } from './obsidian-notes.ts';
export type NoteKind = 'home' | 'course' | 'concept' | 'source' | 'research' | 'gap' | 'diagnostic' | 'teaching' | 'reviews';
export interface NoteEntry {
    path: string;
    kind: NoteKind;
    courseId: string | null;
    id: string;
    aliases: string[];
    hash: string;
}
export interface CourseEntry {
    path: string;
    title: string;
    mode: string;
    version: number;
    stages: Record<string, number>;
    due: number;
    gaps: number;
}
export interface MaterialEntry {
    fingerprint: string;
    material: StudyMaterial;
}
export interface Manifest {
    format: typeof obsidianFormat;
    lastSync: string | null;
    courses: Record<string, CourseEntry>;
    notes: Record<string, NoteEntry>;
    materials: Record<string, MaterialEntry>;
}
export const manifestPath = '.learning-engine/manifest.json';
export const noteKey = (kind: NoteKind, courseId: string | null, id: string) => kind === 'home' ? 'home' : kind + ':' + courseId + (id === courseId ? '' : ':' + id);
const empty = (): Manifest => ({ format: obsidianFormat, lastSync: null, courses: Object.create(null), notes: Object.create(null), materials: Object.create(null) });
const kinds: NoteKind[] = ['home', 'course', 'concept', 'source', 'research', 'gap', 'diagnostic', 'teaching', 'reviews'];
export function validateManifest(vault: SafeVault, m: Manifest): Manifest {
    if (!m || m.format !== obsidianFormat || !m.courses || !m.notes || !m.materials || typeof m.courses !== 'object' || typeof m.notes !== 'object' || typeof m.materials !== 'object')
        throw new ObsidianError('Unsupported or malformed derived manifest; inspect it before recovery.');
    if (!(m.lastSync === null || typeof m.lastSync === 'string'))
        throw new ObsidianError('Invalid derived sync timestamp.');
    const used = new Set<string>();
    for (const [key, n] of Object.entries(m.notes)) {
        if (!/^[a-z0-9:@-]+$/.test(key) || !n || !kinds.includes(n.kind) || typeof n.path !== 'string' || typeof n.id !== 'string' || !Array.isArray(n.aliases) || n.aliases.length > 20 || n.aliases.some(a => typeof a !== 'string' || a.length > 1000) || typeof n.hash !== 'string')
            throw new ObsidianError('Invalid note mapping.');
        if (key !== noteKey(n.kind, n.courseId, n.id) || !n.path.endsWith('.md') || (n.kind === 'home' && (n.courseId !== null || n.id !== 'home')))
            throw new ObsidianError('Inconsistent note identity mapping.');
        vault.path(n.path);
        if (n.kind === 'home' ? n.path !== 'Home.md' : !n.path.startsWith('Courses/'))
            throw new ObsidianError('Invalid managed-note namespace.');
        const lower = n.path.normalize('NFC').toLowerCase();
        if (used.has(lower))
            throw new ObsidianError('Case-colliding note mappings.');
        used.add(lower);
    }
    for (const [id, c] of Object.entries(m.courses)) {
        if (!/^course-[a-f0-9-]{36}$/.test(id) || !c || typeof c.path !== 'string' || !/^Courses\/[^/]+$/.test(c.path))
            throw new ObsidianError('Invalid course mapping.');
        vault.path(c.path);
        const sub = { concept: 'Concepts/', source: 'Sources/', research: 'Sources/', gap: 'Gaps/', diagnostic: 'Sessions/Diagnostics/', teaching: 'Sessions/Teaching/' };
        for (const n of Object.values(m.notes).filter(n => n.courseId === id)) {
            const expected = n.kind === 'course' ? c.path + '/Dashboard.md' : n.kind === 'reviews' ? c.path + '/Review Queue.md' : c.path + '/' + sub[n.kind as keyof typeof sub];
            if (!n.path.startsWith(expected))
                throw new ObsidianError('Note mapping leaves its managed namespace.');
        }
    }
    if (Object.keys(m.notes).length > 10000 || Object.keys(m.materials).length > 5000)
        throw new ObsidianError('Manifest limits exceeded.');
    return m;
}
/** Recover only managed identities/paths. Edited stage/frontmatter never enters SQLite. */
export function loadManifest(vault: SafeVault): {
    manifest: Manifest;
    bytes: Buffer | null;
} {
    const bytes = vault.read(manifestPath);
    if (bytes) {
        let value: Manifest;
        try {
            value = JSON.parse(decode(bytes));
        }
        catch {
            throw new ObsidianError('Derived manifest is unreadable; preserve it and inspect before recovery.');
        }
        return { manifest: validateManifest(vault, value), bytes };
    }
    const m = empty();
    for (const path of vault.notes()) {
        const b = vault.read(path)!;
        if (!decode(b).includes('learning_engine: true') && !decode(b).includes('LEARNING_ENGINE:'))
            continue;
        let parsed: ReturnType<typeof parseNote>;
        try {
            parsed = parseNote(b);
        }
        catch {
            throw new ObsidianError('Manifest recovery cannot identify note safely: ' + path);
        }
        const meta = parsed.meta, kind = meta.note_kind as NoteKind, key = String(meta.note_key);
        if (!kinds.includes(kind) || typeof meta.entity_id !== 'string' || !(meta.course_id === null || typeof meta.course_id === 'string'))
            throw new ObsidianError('Missing managed-note recovery identity: ' + path);
        if (m.notes[key])
            throw new ObsidianError('Duplicate managed-note recovery identity.');
        m.notes[key] = { path, kind, courseId: meta.course_id as string | null, id: meta.entity_id, aliases: Array.isArray(meta.aliases) ? meta.aliases as string[] : [], hash: '' };
        if (kind === 'course')
            m.courses[String(meta.course_id)] = { path: path.slice(0, -'/Dashboard.md'.length), title: typeof meta.title === 'string' ? meta.title : 'Recovered course', mode: 'recovered', version: 0, stages: {}, due: 0, gaps: 0 };
    }
    // Existing material can be regenerated explicitly after manifest loss. Notes/user regions remain intact.
    return { manifest: validateManifest(vault, m), bytes: null };
}
export function courseFolder(m: Manifest, id: string, title: string): string {
    if (!m.courses[id])
        m.courses[id] = { path: 'Courses/' + readableName(title, id), title, mode: '', version: 0, stages: {}, due: 0, gaps: 0 };
    return m.courses[id]!.path;
}
export function mapNote(m: Manifest, kind: NoteKind, courseId: string | null, id: string, title: string, path: string): NoteEntry {
    const key = noteKey(kind, courseId, id);
    let n = m.notes[key];
    if (!n) {
        n = { path, kind, courseId, id, aliases: [], hash: '' };
        m.notes[key] = n;
    }
    if (!n.aliases.includes(title))
        n.aliases = [...n.aliases, title].slice(-20);
    return n;
}
