import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Concept, CurriculumNode, CurriculumVersion, ProposalEdge } from '../domain/curriculum.ts';
import type { SourceAnchor } from '../domain/source.ts';
import type { GraphRepository } from '../ports/graph-repository.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteGraphRepository implements GraphRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    concept(courseId: string, id: string): Concept | undefined {
        const row = this.db.prepare('SELECT * FROM concepts WHERE course_id=? AND id=?').get(courseId, id);
        return row ? { id: String(row.id), courseId: String(row.course_id), createdAt: String(row.created_at) } : undefined;
    }
    saveDraft(input: Omit<CurriculumVersion, 'version' | 'activatedAt'>, newConcepts: readonly Concept[]): CurriculumVersion {
        return this.transaction(() => {
            const version = Number(this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS next FROM curriculum_versions WHERE course_id=?').get(input.courseId)?.next);
            this.db.prepare('INSERT INTO curriculum_versions(course_id,version,created_at,rationale,uncertainty_json) VALUES (?,?,?,?,?)')
                .run(input.courseId, version, input.createdAt, input.rationale, JSON.stringify(input.uncertainty));
            for (const concept of newConcepts)
                this.db.prepare('INSERT INTO concepts(id,course_id,created_at) VALUES (?,?,?)').run(concept.id, concept.courseId, concept.createdAt);
            for (const node of input.nodes) {
                this.db.prepare('INSERT INTO curriculum_nodes(course_id,version,concept_id,title,type,summary) VALUES (?,?,?,?,?,?)').run(input.courseId, version, node.conceptId, node.title, node.type, node.summary);
                for (const ref of node.sourceRefs)
                    this.db.prepare('INSERT INTO node_source_provenance(course_id,version,concept_id,source_id,source_version,segment_id) VALUES (?,?,?,?,?,?)')
                        .run(input.courseId, version, node.conceptId, ref.sourceId, ref.version, ref.segmentId);
                for (const ref of node.researchRefs)
                    this.db.prepare('INSERT INTO node_research_provenance(course_id,version,concept_id,brief_id,reference_id) VALUES (?,?,?,?,?)')
                        .run(input.courseId, version, node.conceptId, ref.briefId, ref.referenceId);
            }
            for (const edge of input.edges)
                this.db.prepare('INSERT INTO curriculum_edges(course_id,version,from_id,to_id,type,rationale) VALUES (?,?,?,?,?,?)')
                    .run(input.courseId, version, edge.from, edge.to, edge.type, edge.rationale);
            return this.get(input.courseId, version)!;
        });
    }
    get(courseId: string, version: number): CurriculumVersion | undefined {
        const row = this.db.prepare('SELECT * FROM curriculum_versions WHERE course_id=? AND version=?').get(courseId, version);
        if (!row)
            return undefined;
        const nodes = this.db.prepare('SELECT * FROM curriculum_nodes WHERE course_id=? AND version=? ORDER BY concept_id').all(courseId, version).map((node): CurriculumNode => {
            const sourceRefs = this.db.prepare(`SELECT p.*,s.anchor_json FROM node_source_provenance p JOIN source_segments s ON s.id=p.segment_id
        WHERE p.course_id=? AND p.version=? AND p.concept_id=? ORDER BY p.source_id,p.source_version,p.segment_id`).all(courseId, version, node.concept_id!).map((ref) => ({
                sourceId: String(ref.source_id), version: Number(ref.source_version), segmentId: String(ref.segment_id), anchor: JSON.parse(String(ref.anchor_json)) as SourceAnchor
            }));
            const researchRefs = this.db.prepare('SELECT brief_id,reference_id FROM node_research_provenance WHERE course_id=? AND version=? AND concept_id=? ORDER BY reference_id')
                .all(courseId, version, node.concept_id!).map((ref) => ({ briefId: String(ref.brief_id), referenceId: String(ref.reference_id) }));
            return { conceptId: String(node.concept_id), title: String(node.title), type: String(node.type) as CurriculumNode['type'], summary: String(node.summary), sourceRefs, researchRefs };
        });
        const edges = this.db.prepare('SELECT * FROM curriculum_edges WHERE course_id=? AND version=? ORDER BY from_id,type,to_id').all(courseId, version).map((edge): ProposalEdge => ({
            from: String(edge.from_id), to: String(edge.to_id), type: String(edge.type) as ProposalEdge['type'], rationale: String(edge.rationale)
        }));
        return { courseId, version, createdAt: String(row.created_at), activatedAt: row.activated_at === null ? null : String(row.activated_at),
            nodes, edges, rationale: String(row.rationale), uncertainty: JSON.parse(String(row.uncertainty_json)) as string[] };
    }
    list(courseId: string): CurriculumVersion[] {
        return this.db.prepare('SELECT version FROM curriculum_versions WHERE course_id=? ORDER BY version').all(courseId).map((row: Row) => this.get(courseId, Number(row.version))!);
    }
    current(courseId: string): number | undefined {
        const row = this.db.prepare('SELECT version FROM course_curriculum_current WHERE course_id=?').get(courseId);
        return row ? Number(row.version) : undefined;
    }
    activate(courseId: string, version: number, at: string): void {
        this.transaction(() => {
            if (!this.get(courseId, version))
                throw new Error('Version not found');
            this.db.prepare('UPDATE curriculum_versions SET activated_at=COALESCE(activated_at,?) WHERE course_id=? AND version=?').run(at, courseId, version);
            this.db.prepare('INSERT INTO course_curriculum_current(course_id,version) VALUES (?,?) ON CONFLICT(course_id) DO UPDATE SET version=excluded.version').run(courseId, version);
        });
    }
    private transaction<T>(run: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const value = run();
            this.db.exec('COMMIT');
            return value;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
