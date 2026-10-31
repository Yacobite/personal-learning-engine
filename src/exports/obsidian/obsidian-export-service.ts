import { ObsidianError } from '../../domain/obsidian.ts';
import type { ObsidianProjectionReader, ObsidianStudyMaterialGenerator } from '../../ports/obsidian.ts';
import { studyMaterial } from '../../services/obsidian-study-material.ts';
import type { DiagnosticTaskContext } from '../../ports/diagnostic-generator.ts';
import { SafeVault } from './obsidian-paths.ts';
import type { VaultIO } from './obsidian-paths.ts';
import { loadManifest, validateManifest, manifestPath, noteKey } from './obsidian-manifest.ts';
import type { Manifest } from './obsidian-manifest.ts';
import { buildPlans, materialFingerprint, materialKey } from './obsidian-renderer.ts';
import type { NotePlan } from './obsidian-renderer.ts';
import { digest, renderNote, parseNote } from './obsidian-notes.ts';
/** One-way filesystem projection. This object has no canonical write capability. */
export class ObsidianExportService {
    readonly vault: SafeVault;
    private readonly reader: ObsidianProjectionReader;
    private readonly clock: () => Date;
    constructor(workspace: string, reader: ObsidianProjectionReader, clock: () => Date = () => new Date(), io?: VaultIO) { this.reader = reader; this.clock = clock; this.vault = new SafeVault(workspace, io); }
    path() { return this.vault.root; }
    init() { return this.vault.lock(() => { const { manifest, bytes } = loadManifest(this.vault); return this.publish(manifest, bytes, buildPlans(manifest)); }); }
    private validateMaterials(m: Manifest) {
        for (const [key, entry] of Object.entries(m.materials)) {
            if (!/^[a-z0-9:-]+$/.test(key) || !entry || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || !entry.material || !Array.isArray(entry.material.sourceRefs) || !Array.isArray(entry.material.researchRefs))
                throw new ObsidianError('Malformed derived study-material cache.');
            const context = { source: entry.material.sourceRefs.map(ref => ({ ref })), research: entry.material.researchRefs.map(ref => ({ ref })) } as DiagnosticTaskContext;
            studyMaterial(context, entry.material);
        }
    }
    sync(courseId: string) { return this.vault.lock(() => { const { manifest, bytes } = loadManifest(this.vault); this.validateMaterials(manifest); const snapshot = this.reader.read(courseId); return this.publish(manifest, bytes, buildPlans(manifest, snapshot)); }); }
    private publish(m: Manifest, prior: Buffer | null, plans: NotePlan[]) {
        validateManifest(this.vault, m);
        // Preflight all owned notes, not just changed notes, before replacing any file.
        for (const [key, entry] of Object.entries(m.notes)) {
            const b = this.vault.read(entry.path);
            if (b) {
                try {
                    parseNote(b, key);
                }
                catch {
                    throw new ObsidianError('Note conflict; original preserved: ' + entry.path);
                }
            }
        }
        const writes = plans.map(p => { const before = this.vault.read(p.entry.path); let bytes: Buffer; try {
            bytes = renderNote(p.key, p.fields, p.body, before);
        }
        catch {
            throw new ObsidianError('Note conflict; original preserved: ' + p.entry.path);
        } p.entry.hash = digest(JSON.stringify([p.fields, p.body])); return { path: p.entry.path, before, bytes }; });
        const changed = writes.filter(w => !w.before?.equals(w.bytes));
        const current = Buffer.from(JSON.stringify(m, null, 2) + '\n');
        if (changed.length || !prior?.equals(current))
            m.lastSync = this.clock().toISOString();
        const manifestBytes = Buffer.from(JSON.stringify(m, null, 2) + '\n');
        for (const w of changed)
            this.vault.write(w.path, w.bytes, w.before);
        // Publish only after every planned note succeeds. Partial file progress is recoverable; never claim a failed sync.
        this.vault.write(manifestPath, manifestBytes, prior);
        return { path: this.path(), written: changed.length, notes: Object.keys(m.notes).length, lastSync: m.lastSync };
    }
    status(courseId?: string) {
        const { manifest, bytes } = loadManifest(this.vault);
        this.validateMaterials(manifest);
        const notes = Object.values(manifest.notes).filter(n => !courseId || n.courseId === courseId), conflicts: string[] = [];
        for (const n of notes) {
            try {
                const b = this.vault.read(n.path);
                if (!b)
                    conflicts.push(n.path + ' (missing)');
                else
                    parseNote(b, noteKey(n.kind, n.courseId, n.id));
            }
            catch {
                conflicts.push(n.path);
            }
        }
        let stale = 0, missing = 0, activeConcepts: number | null = null;
        const concepts = notes.filter(n => n.kind === 'concept').length;
        if (courseId) {
            const s = this.reader.read(courseId);
            activeConcepts = s.graph.nodes.length;
            for (const n of s.graph.nodes) {
                const cache = manifest.materials[materialKey(courseId, n.conceptId)];
                if (!cache)
                    missing++;
                else if (cache.fingerprint !== materialFingerprint(s, n))
                    stale++;
            }
        }
        return { path: this.path(), selectedCourse: courseId ?? null, initialized: bytes !== null, conceptNotes: concepts, activeConcepts, missingMaterials: missing, staleMaterials: stale, conflicts: conflicts.slice(0, 30), lastSuccessfulSync: manifest.lastSync };
    }
    async enrich(courseId: string, target: string, generator: ObsidianStudyMaterialGenerator) {
        this.sync(courseId);
        const initial = this.reader.read(courseId), ids = target === 'all' ? initial.graph.nodes.map(n => n.conceptId).sort() : [target];
        if (ids.some(id => !initial.graph.nodes.some(n => n.conceptId === id)))
            throw new ObsidianError('Concept is absent from the active curriculum.');
        const result: {
            conceptId: string;
            status: 'updated' | 'current' | 'failed';
            message?: string;
        }[] = [];
        for (const id of ids) {
            try {
                const s = this.reader.read(courseId), n = s.graph.nodes.find(n => n.conceptId === id);
                if (!n)
                    throw new ObsidianError('Curriculum changed during enrichment; retry.');
                const fingerprint = materialFingerprint(s, n), cache = loadManifest(this.vault).manifest.materials[materialKey(courseId, id)];
                if (target === 'all' && cache?.fingerprint === fingerprint) {
                    result.push({ conceptId: id, status: 'current' });
                    continue;
                }
                const context = this.reader.ground(courseId, id), material = studyMaterial(context, await generator.propose(structuredClone(context)));
                this.vault.lock(() => {
                    const fresh = this.reader.read(courseId), node = fresh.graph.nodes.find(n => n.conceptId === id);
                    if (!node || materialFingerprint(fresh, node) !== fingerprint)
                        throw new ObsidianError('Grounding changed during enrichment; stale proposal rejected.');
                    const { manifest, bytes } = loadManifest(this.vault);
                    this.validateMaterials(manifest);
                    manifest.materials[materialKey(courseId, id)] = { fingerprint, material };
                    this.publish(manifest, bytes, buildPlans(manifest, fresh));
                });
                result.push({ conceptId: id, status: 'updated' });
            }
            catch {
                result.push({ conceptId: id, status: 'failed', message: 'Study material was not updated. Existing notes are preserved; inspect status and retry enrichment.' });
            }
        }
        return { path: this.path(), results: result };
    }
}
