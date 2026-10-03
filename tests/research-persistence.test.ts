import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SqliteFoundationStore } from '../src/persistence/database.ts';
import { applyMigrations } from '../src/persistence/migrations.ts';
import { ResearchService } from '../src/services/research-service.ts';
import { CourseService } from '../src/services/course-service.ts';
import type { ResearchBrief } from '../src/domain/research.ts';
test('research metadata and failed references persist separately from learner sources, with transactional rollback and course isolation', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    applyMigrations(db);
    const store = new SqliteFoundationStore(db);
    try {
        const courses = new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
        const course = courses.createCourse({ title: 'Python', mode: 'generated_curriculum', objective: 'Python from zero' });
        const brief: ResearchBrief = { id: `brief-${randomUUID()}`, courseId: course.id, goal: course.objective, createdAt: new Date().toISOString(), references: [{
                    id: `reference-${randomUUID()}`, url: 'https://docs.python.org/3/tutorial/introduction.html', title: null, publisher: 'Python Software Foundation', retrievedAt: new Date().toISOString(),
                    contentHash: null, authority: 'official_documentation', status: 'failed', text: '', topics: ['values'], notes: ['Unavailable synthetic document']
                }] };
        const service = new ResearchService(courses, store.research, { retrieve: async () => brief });
        await service.retrieve(course.id);
        assert.deepEqual(service.get(course.id, brief.id), brief);
        assert.equal(store.sources.list(course.id).length, 0);
        assert.equal(store.research.get('other-course', brief.id), undefined);
        db.exec("CREATE TRIGGER research_failure BEFORE INSERT ON research_references BEGIN SELECT RAISE(ABORT,'injected'); END;");
        assert.throws(() => store.research.save({ ...brief, id: `brief-${randomUUID()}`, references: [{ ...brief.references[0]!, id: `reference-${randomUUID()}` }] }));
        assert.equal(store.research.list(course.id).length, 1);
        db.exec('DROP TRIGGER research_failure');
        assert.throws(() => store.research.save({ ...brief, id: `brief-${randomUUID()}`, references: [{ ...brief.references[0]!, id: `reference-${randomUUID()}`, status: 'ready' }] }), /CHECK/);
        assert.equal(store.research.list(course.id).length, 1);
    }
    finally {
        store.close();
    }
});
