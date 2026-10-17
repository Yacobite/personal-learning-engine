import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { systemFixture, fillProfile } from './helpers/system-fixtures.ts';
test('combined restart/replay preserves M4 failures, pending teaching/review and populated schema-nine audit', async () => {
    const f = await systemFixture();
    const evaluator = new DeterministicEvaluator();
    const failed = { identity: evaluator.identity, evaluate: async () => { throw Error('SYNTHETIC evaluation failure'); } };
    try {
        let r = f.runtime;
        const d = r.diagnostics.start(f.course.id, 1);
        const [da, db] = await Promise.all([r.diagnostics.next(f.course.id, f.diagnosticGenerator), r.diagnostics.next(f.course.id, f.diagnosticGenerator)]);
        assert.equal(da.probe!.id, db.probe!.id);
        const input = { response: 'beta', assistance: 'none' as const, hints: { count: 0, highestLevel: 'none' as const, notes: null } };
        const submitted = await r.diagnostics.submit(f.course.id, da.probe!.id, input, evaluator);
        assert.equal((await r.diagnostics.submit(f.course.id, da.probe!.id, input, evaluator)).attemptId, submitted.attemptId);
        await r.diagnostics.next(f.course.id, f.diagnosticGenerator);
        const teaching = r.teaching.start(f.course.id);
        const teachingResults = await Promise.allSettled([r.teaching.next(f.course.id, f.teachingGenerator), r.teaching.next(f.course.id, f.teachingGenerator)]);
        assert.equal(teachingResults.filter(x => x.status === 'fulfilled').length, 1);
        assert.equal(teachingResults.filter(x => x.status === 'rejected').length, 1);
        const ta = await r.teaching.next(f.course.id, f.teachingGenerator);
        assert.equal(r.teaching.moves(f.course.id, teaching.id).length, 1);
        const answered = await r.teaching.answer(f.course.id, ta.move!.id, { response: 'alpha' }, failed);
        assert.equal(answered.status, 'answered');
        f.restart();
        r = f.runtime;
        assert.equal(r.teaching.current(f.course.id)!.id, teaching.id);
        assert.equal((await r.teaching.next(f.course.id, f.teachingGenerator)).move!.id, answered.id);
        const retry = await r.teaching.retry(f.course.id, answered.id, evaluator);
        assert.equal(retry.attemptId, answered.attemptId);
        assert.equal(r.evaluations.list(f.course.id, retry.attemptId!).length, 2);
        r.teaching.abandon(f.course.id);
        fillProfile(f);
        const scheduled = r.reviews.queue(f.course.id).upcoming[0]!;
        f.set(scheduled.dueAt);
        const [ra, rb] = await Promise.all([r.reviews.next(f.course.id, f.reviewGenerator), r.reviews.next(f.course.id, f.reviewGenerator)]);
        assert.equal(ra.item!.id, rb.item!.id);
        assert.equal(ra.item!.taskId, rb.item!.taskId);
        const pending = await r.reviews.answer(f.course.id, ra.item!.id, { response: 'alpha' }, failed);
        assert.equal(pending.item.status, 'awaiting_evaluation');
        f.restart();
        r = f.runtime;
        assert.equal((await r.reviews.next(f.course.id, f.reviewGenerator)).item!.attemptId, pending.item.attemptId);
        const completed = await r.reviews.retryEvaluation(f.course.id, pending.item.id, evaluator);
        assert.equal(completed.item.attemptId, pending.item.attemptId);
        assert.equal(completed.item.status, 'completed');
        const evidence = r.store.assessments.evidenceForAttempt(f.course.id, pending.item.attemptId!)[0]!;
        const snapshot = () => ({ diagnostic: r.diagnostics.audit(f.course.id, d.id), teaching: r.teaching.audit(f.course.id, teaching.id), evidence: r.evidence.show(f.course.id, evidence.id), revision: r.state.current(f.course.id), reviews: r.store.reviews.list(f.course.id) });
        const before = JSON.stringify(snapshot());
        f.restart();
        r = f.runtime;
        assert.equal(JSON.stringify(snapshot()), before);
        assert.equal(r.store.health.diagnose(f.course.id).foreignKeyViolations, 0);
        const basis = r.reviews.refresh(f.course.id);
        const view = new DatabaseSync(join(f.root, '_learning', 'learning.db'), { readOnly: true });
        try {
            const tables = view.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => String(x.name));
            const rows = () => JSON.stringify(tables.map(t => view.prepare('SELECT * FROM "' + t.replaceAll('"', '""') + '"').all()));
            const before = rows();
            r.evidence.show(f.course.id, evidence.id);
            r.state.revision(f.course.id, basis.id);
            r.reviews.show(f.course.id, completed.item.id);
            r.store.health.diagnose(f.course.id);
            r.reviews.refresh(f.course.id);
            assert.equal(rows(), before);
        }
        finally {
            view.close();
        }
    }
    finally {
        f.close();
    }
});
