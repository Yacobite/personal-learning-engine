import type { DatabaseSync } from 'node:sqlite';
import type { ResearchBrief, ResearchReference } from '../domain/research.ts';
import type { ResearchRepository } from '../ports/research.ts';
export class SqliteResearchRepository implements ResearchRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    save(brief: ResearchBrief): void {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('INSERT INTO research_briefs(id,course_id,goal,created_at) VALUES (?,?,?,?)').run(brief.id, brief.courseId, brief.goal, brief.createdAt);
            for (const ref of brief.references)
                this.db.prepare(`INSERT INTO research_references
        (id,brief_id,course_id,url,title,publisher,retrieved_at,content_hash,authority,status,text,topics_json,notes_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                    .run(ref.id, brief.id, brief.courseId, ref.url, ref.title, ref.publisher, ref.retrievedAt, ref.contentHash, ref.authority, ref.status, ref.text, JSON.stringify(ref.topics), JSON.stringify(ref.notes));
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    get(courseId: string, id: string): ResearchBrief | undefined {
        const row = this.db.prepare('SELECT * FROM research_briefs WHERE course_id=? AND id=?').get(courseId, id);
        if (!row)
            return undefined;
        const references = this.db.prepare('SELECT * FROM research_references WHERE course_id=? AND brief_id=? ORDER BY url,id').all(courseId, id).map((ref): ResearchReference => ({
            id: String(ref.id), url: String(ref.url), title: ref.title === null ? null : String(ref.title), publisher: 'Python Software Foundation', retrievedAt: String(ref.retrieved_at),
            contentHash: ref.content_hash === null ? null : String(ref.content_hash), authority: 'official_documentation', status: String(ref.status) as ResearchReference['status'], text: String(ref.text),
            topics: JSON.parse(String(ref.topics_json)) as string[], notes: JSON.parse(String(ref.notes_json)) as string[]
        }));
        return { id, courseId, goal: String(row.goal), createdAt: String(row.created_at), references };
    }
    list(courseId: string): ResearchBrief[] { return this.db.prepare('SELECT id FROM research_briefs WHERE course_id=? ORDER BY created_at,id').all(courseId).map((row) => this.get(courseId, String(row.id))!); }
}
