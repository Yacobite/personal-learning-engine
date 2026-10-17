import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { LearnerStateRepository } from '../ports/learner-state-repository.ts';
import type { GapIdentity, LearnerStateRevision } from '../domain/learner-state.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteLearnerStateRepository implements LearnerStateRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    private map(r: Row): LearnerStateRevision {
        const id = String(r.id), courseId = String(r.course_id);
        const rows = (table: string) => this.db.prepare('SELECT snapshot_json FROM ' + table + ' WHERE revision_id=? ORDER BY rowid').all(id).map(s => JSON.parse(String(s.snapshot_json)));
        return { id, courseId, curriculumVersion: Number(r.curriculum_version), number: Number(r.revision_number), policies: JSON.parse(String(r.policies_json)), createdAt: String(r.created_at), asOf: String(r.as_of), fingerprint: String(r.fingerprint), observations: JSON.parse(String(r.observations_json)), dimensions: rows('learner_dimensions'), gaps: rows('learner_gap_snapshots'), readiness: rows('learner_readiness') };
    }
    get(courseId: string, id: string) { const r = this.db.prepare('SELECT * FROM learner_revisions WHERE course_id=? AND id=?').get(courseId, id); return r ? this.map(r) : undefined; }
    current(courseId: string, version: number) { const r = this.db.prepare('SELECT r.* FROM learner_current c JOIN learner_revisions r ON r.id=c.revision_id WHERE c.course_id=? AND c.curriculum_version=?').get(courseId, version); return r ? this.map(r) : undefined; }
    history(courseId: string) { return this.db.prepare('SELECT * FROM learner_revisions WHERE course_id=? ORDER BY curriculum_version,revision_number').all(courseId).map(r => this.map(r)); }
    refresh(courseId: string, version: number, build: (identities: readonly GapIdentity[], number: number) => LearnerStateRevision): LearnerStateRevision {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const identities = this.db.prepare('SELECT * FROM learner_gap_identities WHERE course_id=? ORDER BY id').all(courseId).map(r => ({ id: String(r.id), courseId, conceptId: String(r.concept_id), dimension: r.dimension as GapIdentity['dimension'], triggerAttemptId: String(r.trigger_attempt_id), policy: String(r.policy) }));
            const number = Number(this.db.prepare('SELECT coalesce(max(revision_number),0)+1 AS n FROM learner_revisions WHERE course_id=? AND curriculum_version=?').get(courseId, version)!.n);
            const r = build(identities, number);
            if (r.courseId !== courseId || r.curriculumVersion !== version || r.number !== number)
                throw Error('Projection scope mismatch.');
            const same = this.db.prepare('SELECT * FROM learner_revisions WHERE course_id=? AND curriculum_version=? AND fingerprint=?').get(courseId, version, r.fingerprint);
            if (same) {
                this.db.exec('COMMIT');
                return this.map(same);
            }
            for (const g of r.gaps) {
                if (!identities.some(i => i.id === g.id))
                    this.db.prepare('INSERT INTO learner_gap_identities VALUES (?,?,?,?,?,?)').run(g.id, courseId, g.conceptId, g.dimension, g.triggerAttemptId, g.policy);
                this.db.prepare('INSERT INTO learner_gap_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)').run(r.id, courseId, g.conceptId, g.dimension, g.id, g.status, g.recursFrom, g.awaitingAttemptId, g.eligibleAfter, JSON.stringify(g));
                for (const [index, t] of g.transitions.entries())
                    this.db.prepare('INSERT INTO learner_gap_evidence VALUES (?,?,?,?,?,?,?,?)').run(r.id, courseId, g.id, index + 1, t.status, t.ref.attemptId, t.ref.evaluationId, t.ref.evidenceId);
            }
            for (const d of r.dimensions) {
                this.db.prepare('INSERT INTO learner_dimensions VALUES (?,?,?,?,?,?,?)').run(r.id, courseId, version, d.conceptId, d.dimension, d.band, JSON.stringify(d));
                for (const role of ['supporting', 'contradictory', 'contextual'] as const)
                    for (const ref of d[role])
                        this.db.prepare('INSERT INTO learner_dimension_evidence VALUES (?,?,?,?,?,?,?,?)').run(r.id, courseId, d.conceptId, d.dimension, role, ref.attemptId, ref.evaluationId, ref.evidenceId);
            }
            for (const report of r.readiness)
                this.db.prepare('INSERT INTO learner_readiness VALUES (?,?,?,?,?,?)').run(r.id, courseId, version, report.conceptId, report.stage, JSON.stringify(report));
            // Parent-last insertion seals all child projections at publication.
            this.db.prepare('INSERT INTO learner_revisions VALUES (?,?,?,?,?,?,?,?,?)').run(r.id, courseId, version, number, JSON.stringify(r.policies), r.createdAt, r.asOf, r.fingerprint, JSON.stringify(r.observations));
            const previous = this.current(courseId, version);
            if (!previous || r.asOf >= previous.asOf)
                this.db.prepare('INSERT INTO learner_current VALUES (?,?,?) ON CONFLICT(course_id,curriculum_version) DO UPDATE SET revision_id=excluded.revision_id').run(courseId, version, r.id);
            this.db.exec('COMMIT');
            return this.get(courseId, r.id)!;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
}
