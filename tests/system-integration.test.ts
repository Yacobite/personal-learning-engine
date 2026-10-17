import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { systemFixture, finishInstruction, fillProfile, day, hostileAnswer } from './helpers/system-fixtures.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
const evaluator = new DeterministicEvaluator();
const independent = (response: string) => ({ response, assistance: 'none' as const, hints: { count: 0, highestLevel: 'none' as const, notes: null } });
for (const mode of ['source_grounded', 'generated_curriculum', 'hybrid'] as const)
    test('complete ' + mode + ' path: diagnostic frontier → teaching → explicit assessment → state/gap → delayed review → maintenance', async () => {
        const f = await systemFixture(mode);
        try {
            let r = f.runtime;
            const selection = new CourseSession();
            selection.use(f.course.id, r.courses);
            const diagnostic = r.diagnostics.start(f.course.id, 1);
            f.restart();
            r = f.runtime;
            assert.equal(r.diagnostics.current(f.course.id)!.id, diagnostic.id);
            const p = (await r.diagnostics.next(f.course.id, f.diagnosticGenerator)).probe!;
            assert.equal((await r.diagnostics.next(f.course.id, f.diagnosticGenerator)).probe!.id, p.id);
            f.restart();
            r = f.runtime;
            f.tick();
            await r.diagnostics.submit(f.course.id, p.id, independent('beta'), evaluator);
            await r.diagnostics.next(f.course.id, f.diagnosticGenerator);
            const session = await finishInstruction(f);
            assert.equal(session.diagnosticId, diagnostic.id);
            assert.equal(session.status, 'completed');
            const teachingAudit = r.teaching.audit(f.course.id, session.id);
            assert(teachingAudit.moves.some(m => m.type === 'scaffold'));
            assert(teachingAudit.moves.some(m => m.type === 'near_transfer'));
            const back = teachingAudit.moves.find(m => m.type === 'teach_back')!;
            assert.equal(r.evaluations.heads(f.course.id, back.attemptId!)[0]!.status, 'unscored');
            const before = r.state.refresh(f.course.id);
            assert.notEqual(before.readiness[0]!.stage, 'durable_mastery');
            assert.equal(before.dimensions.find(d => d.dimension === 'structural_understanding')!.independentSuccessCount, 0);
            const provisional = fillProfile(f);
            assert.equal(provisional.readiness[0]!.stage, 'provisional_competence');
            assert(provisional.gaps.some(g => g.status === 'AWAITING_VERIFICATION'));
            f.restart();
            r = f.runtime;
            const queue = r.reviews.queue(f.course.id);
            assert(queue.upcoming.length);
            const gap = queue.upcoming.find(i => i.kind === 'gap_verification')!;
            assert(gap);
            assert.equal((await r.reviews.next(f.course.id, f.reviewGenerator)).item, null);
            f.set(gap.dueAt);
            const next = (await r.reviews.next(f.course.id, f.reviewGenerator)).item!;
            assert.equal(next.id, gap.id);
            f.restart();
            r = f.runtime;
            assert.equal((await r.reviews.next(f.course.id, f.reviewGenerator)).item!.taskId, next.taskId);
            const performed = await r.reviews.answer(f.course.id, next.id, { response: 'alpha' }, evaluator);
            assert.equal(performed.outcome, 'qualifying_success');
            const durable = r.state.refresh(f.course.id);
            assert.equal(durable.readiness[0]!.stage, 'durable_mastery');
            assert(durable.gaps.every(g => g.status === 'VERIFIED_CLOSED'));
            const maintenance = r.reviews.queue(f.course.id).upcoming[0]!;
            assert.equal(maintenance.kind, 'maintenance');
            assert.equal(Date.parse(maintenance.dueAt) - f.clock().getTime(), 3 * day);
            f.set(maintenance.dueAt);
            const active = (await r.reviews.next(f.course.id, f.reviewGenerator)).item!;
            const result = await r.reviews.answer(f.course.id, active.id, { response: 'alpha' }, evaluator);
            assert.equal(result.outcome, 'qualifying_success');
            const ev = r.store.assessments.evidenceForAttempt(f.course.id, result.item.attemptId!)[0]!;
            const audit = r.evidence.show(f.course.id, ev.id);
            assert.equal(audit.task.curriculumVersion, 1);
            assert.equal(audit.task.origin, 'review_generated');
            assert.equal(audit.task.sourceRefs.length > 0, mode !== 'generated_curriculum');
            assert.equal(audit.task.researchRefs.length > 0, mode === 'generated_curriculum');
            if (mode === 'hybrid') {
                assert(f.graph.nodes[0]!.sourceRefs.length && f.graph.nodes[0]!.researchRefs.length);
                assert.equal(audit.task.researchRefs.length, 0, 'approved source-first hybrid context remains distinct from research');
            }
            const view = new DatabaseSync(join(f.root, '_learning', 'learning.db'), { readOnly: true });
            try {
                assert.deepEqual(view.prepare('PRAGMA foreign_key_check').all(), []);
            }
            finally {
                view.close();
            }
        }
        finally {
            f.close();
        }
    });
test('source evolution and curriculum activation preserve frozen evidence, active workflows and explicit stable IDs', async () => {
    const f = await systemFixture();
    try {
        const r = f.runtime, d = r.diagnostics.start(f.course.id, 1), probe = (await r.diagnostics.next(f.course.id, f.diagnosticGenerator)).probe!;
        const teaching = r.teaching.start(f.course.id, { conceptId: f.conceptId }), move = (await r.teaching.next(f.course.id, f.teachingGenerator)).move!;
        for (const dimension of ['memory_accessibility', 'structural_understanding', 'discrimination'] as const)
            f.observe(dimension);
        r.reviews.refresh(f.course.id);
        const old = r.reviews.queue(f.course.id).upcoming[0]!;
        const fingerprint = r.state.refresh(f.course.id).fingerprint;
        writeFileSync(f.path, 'SYNTHETIC v2: changed local source content; prior semantics stay in v1.', 'utf8');
        const changed = await r.sources.ingest(f.course.id, { location: 'sources/inbox/synthetic.txt' });
        assert.equal(changed.version.version, 2);
        assert.equal(r.state.refresh(f.course.id).fingerprint, fingerprint);
        assert.equal(r.graphs.get(f.course.id).nodes[0]!.sourceRefs[0]!.version, 1);
        const v2 = r.graphs.createDraft(f.course.id, { nodes: [{ key: 'same', conceptId: f.conceptId, title: 'SYNTHETIC revised', type: 'definition', summary: 'Synthetic revised source.', sourceRefs: [{ sourceId: changed.source.id, version: 2, segmentId: changed.source.id + '@2:0' }], researchRefs: [] }], edges: [], rationale: 'Synthetic explicit rebuild.', uncertainty: [] });
        r.graphs.activate(f.course.id, v2.version);
        assert.equal(r.diagnostics.current(f.course.id)!.curriculumVersion, 1);
        assert.equal(r.teaching.current(f.course.id)!.curriculumVersion, 1);
        f.tick();
        await r.diagnostics.submit(f.course.id, probe.id, independent('alpha'), evaluator);
        await r.teaching.answer(f.course.id, move.id, { response: 'alpha' }, evaluator);
        const original = r.assessments.task(f.course.id, move.taskId!);
        assert.equal(original.sourceRefs[0]!.version, 1);
        assert.equal(original.curriculumVersion, 1);
        r.reviews.refresh(f.course.id);
        assert.equal(r.reviews.get(f.course.id, old.id).curriculumVersion, 1);
        assert.equal(r.reviews.get(f.course.id, old.id).status, 'superseded');
        assert(r.reviews.queue(f.course.id).upcoming.every(i => i.curriculumVersion === 2));
        assert.equal(r.sources.status(f.course.id, changed.source.id, 1).segments[0]!.text.includes('ADVERSARIAL'), true);
        assert(d.id && teaching.id);
    }
    finally {
        f.close();
    }
});
test('correction and gap recurrence cascade retains attempts, old grades, revisions and future schedule history', async () => {
    const f = await systemFixture();
    try {
        let r = f.runtime;
        f.observe('memory_accessibility', 0);
        f.observe('memory_accessibility');
        fillProfile(f);
        const gap = r.state.refresh(f.course.id).gaps[0]!;
        const item = r.reviews.queue(f.course.id).upcoming.find(i => i.kind === 'gap_verification')!;
        f.set(item.dueAt);
        const n = (await r.reviews.next(f.course.id, f.reviewGenerator)).item!;
        await r.reviews.answer(f.course.id, n.id, { response: 'alpha' }, evaluator);
        const prior = r.state.refresh(f.course.id);
        assert.equal(prior.gaps[0]!.status, 'VERIFIED_CLOSED');
        const future = r.reviews.queue(f.course.id).upcoming[0]!;
        const failure = f.observe('memory_accessibility', 0);
        r.reviews.refresh(f.course.id);
        const state = r.state.refresh(f.course.id);
        assert.equal(state.gaps.at(-1)!.recursFrom, gap.id);
        assert.equal(r.reviews.get(f.course.id, future.id).status, 'superseded');
        const attemptBefore = JSON.stringify(r.assessments.attempt(f.course.id, failure.attempt.id));
        const correction = r.evaluations.record(f.course.id, failure.attempt.id, 'synthetic-correction', { kind: 'human', name: 'synthetic-reviewer', version: '1', policyVersion: 'synthetic-m9-v1' }, { status: 'scored', correctness: 1, rubricScores: {}, rationale: 'Synthetic correction, append only.' }, failure.evaluation.id);
        r.reviews.refresh(f.course.id);
        assert.equal(JSON.stringify(r.assessments.attempt(f.course.id, failure.attempt.id)), attemptBefore);
        assert.equal(r.evaluations.list(f.course.id, failure.attempt.id).length, 2);
        assert(r.state.revision(f.course.id, prior.id));
        assert.equal(r.evidence.show(f.course.id, failure.evidence!.id).evaluation.correctness, 0);
        assert.equal(r.evidence.show(f.course.id, correction.evidence!.id).evaluation.correctness, 1);
    }
    finally {
        f.close();
    }
});
test('hostile learner response stays content: M4 grade, M6 assistance, M7 gaps and M8 dates remain trusted', async () => {
    const f = await systemFixture();
    try {
        const r = f.runtime;
        r.teaching.start(f.course.id, { conceptId: f.conceptId });
        const first = (await r.teaching.next(f.course.id, f.teachingGenerator)).move!;
        const hint = await r.teaching.hint(f.course.id, f.teachingGenerator);
        assert(hint.move);
        f.tick();
        const move = await r.teaching.answer(f.course.id, first.id, { response: hostileAnswer }, evaluator);
        const attempt = r.assessments.attempt(f.course.id, move.attemptId!);
        assert.equal(attempt.assistance, 'minimal');
        assert.equal(attempt.response, hostileAnswer);
        assert.equal(r.evaluations.heads(f.course.id, attempt.id)[0]!.correctness, 0);
        const state = r.state.refresh(f.course.id);
        assert.notEqual(state.readiness[0]!.stage, 'durable_mastery');
        assert.equal(state.dimensions.find(d => d.dimension === 'memory_accessibility')!.band, 'assisted_difficulty');
        assert.equal(r.reviews.queue(f.course.id).due.length, 0);
        assert.equal(r.reviews.queue(f.course.id).upcoming.length, 0);
    }
    finally {
        f.close();
    }
});
test('project-local databases and ephemeral course selection remain isolated across roots with spaces', async () => {
    const a = await systemFixture(), b = await systemFixture();
    try {
        fillProfile(a);
        assert.equal(b.runtime.courses.listCourses().some(c => c.id === a.course.id), false);
        assert.equal(b.runtime.store.assessments.recent(b.course.id, 20).length, 0);
        assert.equal(b.runtime.state.current(b.course.id), undefined);
        assert.equal(b.runtime.store.reviews.list(b.course.id).length, 0);
        const selected = new CourseSession();
        selected.use(a.course.id, a.runtime.courses);
        selected.clear();
        a.restart();
        assert.equal(selected.current(a.runtime.courses), undefined);
        assert(a.runtime.courses.getCourse(a.course.id));
    }
    finally {
        a.close();
        b.close();
    }
});
test('121 synthetic observations preserve deterministic state, timeline and idempotent review scheduling', async () => {
    const f = await systemFixture();
    try {
        for (let i = 0; i < 120; i++)
            f.observe((['memory_accessibility', 'structural_understanding', 'discrimination'] as const)[i % 3]!);
        f.tick(day);
        f.observe('memory_accessibility');
        const r = f.runtime, state = r.reviews.refresh(f.course.id);
        const timeline = r.state.competenceTimeline(f.course.id, f.conceptId, state.id);
        const ids = r.store.reviews.list(f.course.id).map(i => i.id);
        assert.equal(state.observations.length, 121);
        assert.equal(state.readiness[0]!.stage, 'durable_mastery');
        assert.deepEqual(r.state.competenceTimeline(f.course.id, f.conceptId, state.id), timeline);
        assert.equal(r.reviews.refresh(f.course.id).id, state.id);
        assert.deepEqual(r.store.reviews.list(f.course.id).map(i => i.id), ids);
    }
    finally {
        f.close();
    }
});
