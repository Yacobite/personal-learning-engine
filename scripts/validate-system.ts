import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { systemRuntime, id, hash, day } from '../tests/helpers/system-fixtures.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { competenceProfile } from '../src/domain/competence-profile.ts';
import type { DiagnosticTaskContext } from '../src/ports/diagnostic-generator.ts';
import type { TeachingContext } from '../src/ports/teaching-generator.ts';
import type { ReviewTaskContext } from '../src/ports/review-generator.ts';
const [workspace, courseId, mode = 'logic'] = process.argv.slice(2);
if (!workspace || !courseId || !['logic', 'python'].includes(mode))
    throw Error('Usage: node scripts/validate-system.ts <historical-workspace> <course-id> [logic|python]');
const original = resolve(workspace, '_learning/learning.db'), digest = () => hash(readFileSync(original).toString('base64')), before = digest();
const parent = resolve('_learning/m9-acceptance');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'run-'));
mkdirSync(join(root, '_learning'));
const reader = new DatabaseSync(original, { readOnly: true });
const originalLedger = reader.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
try {
    await backup(reader, join(root, '_learning/learning.db'));
}
finally {
    reader.close();
}
let time = Date.parse('2050-01-01T00:00:00.000Z'), sequence = 0;
const clock = () => new Date(time);
let r = systemRuntime(root, clock);
const evaluator = new DeterministicEvaluator();
const events: unknown[] = [];
const restart = () => { r.store.close(); r = systemRuntime(root, clock); };
const refs = (g: DiagnosticTaskContext) => ({ sourceRefs: g.source.map(s => s.ref), researchRefs: g.research.map(s => s.ref) });
const diagnosticGenerator = { propose: async (g: DiagnosticTaskContext) => ({ prompt: 'SYNTHETIC M9 DIAGNOSTIC ORCHESTRATION ' + (++sequence) + ' ' + g.conceptId + '. Type the development token alpha. This does not measure course knowledge.', scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' }, ...refs(g) }) };
const teachingGenerator = { propose: async (c: TeachingContext) => ({ components: ['explain', 'scaffold'].includes(c.moveType) ? { coreIdea: 'SYNTHETIC M9 instruction orchestration cue. This is not reviewed course teaching content.' } : {}, task: ['explain', 'scaffold'].includes(c.moveType) ? null : { prompt: 'SYNTHETIC M9 TEACHING ORCHESTRATION ' + (++sequence) + ' ' + c.moveType + '. Development response alpha; rich response is capture-only.', scoring: c.moveType === 'teach_back' ? { kind: 'open', rubricVersion: 'synthetic-system-v1', criteria: [{ key: 'capture', description: 'Synthetic explanation capture; no semantic judgment.' }], expected: null } : { kind: 'text', expected: 'alpha', normalization: 'exact' } }, ...refs(c.grounding) }) };
const reviewGenerator = { propose: async (c: ReviewTaskContext) => ({ prompt: 'SYNTHETIC M9 REVIEW ORCHESTRATION ' + (++sequence) + ' ' + c.item.dimension + '. Select the development token alpha. No claim about actual knowledge.', scoring: { kind: 'choice', options: ['alpha', 'beta'], expected: 'alpha' }, ...refs(c.grounding) }) };
try {
    const graph = r.graphs.get(courseId);
    const diagnostic = r.diagnostics.start(courseId, 4);
    events.push({ step: 'diagnostic_start', id: diagnostic.id, version: diagnostic.curriculumVersion });
    restart();
    await assert.rejects(r.diagnostics.next(courseId, { propose: async () => { throw Error('SYNTHETIC provider unavailable'); } }));
    for (let step = 0; step < 5; step++) {
        time += 1000;
        const n = await r.diagnostics.next(courseId, diagnosticGenerator);
        if (!n.probe)
            break;
        await r.diagnostics.submit(courseId, n.probe.id, { response: step === 0 ? 'beta' : 'alpha', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } }, evaluator);
    }
    const diagnosticFinal = r.diagnostics.get(courseId, diagnostic.id);
    assert.equal(diagnosticFinal.status, 'completed');
    assert(diagnosticFinal.summary!.frontier.length);
    events.push({ step: 'diagnostic_complete', frontier: diagnosticFinal.summary!.frontier });
    const teaching = r.teaching.start(courseId, { budget: 80 }), target = teaching.recommendations[0]!;
    events.push({ step: 'teaching_from_frontier', id: teaching.id, diagnosticId: teaching.diagnosticId, target });
    assert.equal(teaching.diagnosticId, diagnostic.id);
    let answers = 0, failedEvaluation = false;
    for (let step = 0; step < 80; step++) {
        time += 1000;
        const n = await r.teaching.next(courseId, teachingGenerator);
        if (!n.move)
            break;
        if (!n.move.taskId)
            continue;
        const response = answers++ === 0 ? 'beta' : n.move.type === 'teach_back' ? 'SYNTHETIC rich response: no semantic grade.' : 'alpha';
        const m = await r.teaching.answer(courseId, n.move.id, { response }, failedEvaluation ? evaluator : { identity: evaluator.identity, evaluate: async () => { throw Error('SYNTHETIC evaluator unavailable'); } });
        if (!failedEvaluation) {
            assert.equal(m.status, 'answered');
            const attemptId = m.attemptId;
            restart();
            const retried = await r.teaching.retry(courseId, m.id, evaluator);
            assert.equal(retried.attemptId, attemptId);
            failedEvaluation = true;
            events.push({ step: 'teaching_evaluator_recovery', attemptId });
        }
    }
    const finalTeaching = r.teaching.get(courseId, teaching.id);
    assert.equal(finalTeaching.status, 'completed');
    const moves = r.teaching.moves(courseId, teaching.id);
    assert(moves.some(m => m.type === 'scaffold'));
    assert(moves.some(m => m.type === 'near_transfer'));
    const profile = competenceProfile(graph.nodes.find(n => n.conceptId === target)!.type)!;
    assert(profile);
    for (const dimension of profile) {
        time += 1000;
        const task = r.assessments.createTask(courseId, { conceptIds: [target], type: 'error_diagnosis', intendedDimensions: [dimension], representation: 'text', novelty: dimension === 'transfer' ? 'near_transfer' : 'isomorphic', origin: 'manual', prompt: 'SYNTHETIC M9 EXPLICIT DIMENSION CHECK ' + (++sequence) + ' ' + dimension + '. This is development data, not a claim about real learner ability.', scoring: { kind: 'choice', options: ['alpha', 'beta'], expected: 'alpha' }, sourceRefs: graph.nodes.find(n => n.conceptId === target)!.sourceRefs.map(ref => ({ sourceId: ref.sourceId, version: ref.version, segmentId: ref.segmentId })), researchRefs: graph.nodes.find(n => n.conceptId === target)!.researchRefs });
        const a = r.assessments.submit(courseId, 'synthetic-system-explicit:' + sequence, { taskId: task.id, response: 'alpha', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } });
        await r.evaluations.evaluate(courseId, a.id, 'synthetic-system-explicit-eval:' + sequence, evaluator);
    }
    let state = r.reviews.refresh(courseId);
    assert.equal(state.readiness.find(p => p.conceptId === target)!.stage, 'provisional_competence');
    events.push({ step: 'explicit_M4_checks_completed', revisionId: state.id, state: state.readiness.find(p => p.conceptId === target), gaps: state.gaps.filter(g => g.conceptId === target) });
    const scheduled = r.store.reviews.list(courseId).filter(i => i.conceptId === target && i.status === 'scheduled').sort((a, b) => (a.kind === 'gap_verification' ? 0 : 1) - (b.kind === 'gap_verification' ? 0 : 1))[0]!;
    assert(scheduled);
    const earliest = Math.min(...r.store.reviews.list(courseId).filter(i => i.status === 'scheduled').map(i => Date.parse(i.earliestAt)));
    time = earliest - 1;
    assert.equal((await r.reviews.next(courseId, reviewGenerator)).item, null);
    time = Date.parse(scheduled.dueAt);
    let n = (await r.reviews.next(courseId, reviewGenerator)).item!;
    for (let guard = 0; n.id !== scheduled.id && guard < 100; guard++) {
        await r.reviews.answer(courseId, n.id, { response: 'alpha' }, evaluator);
        n = (await r.reviews.next(courseId, reviewGenerator)).item!;
    }
    assert.equal(n.id, scheduled.id);
    restart();
    assert.equal((await r.reviews.next(courseId, reviewGenerator)).item!.id, n.id);
    const result = await r.reviews.answer(courseId, n.id, { response: 'alpha' }, evaluator);
    state = r.state.refresh(courseId);
    assert.equal(state.readiness.find(p => p.conceptId === target)!.stage, 'durable_mastery');
    events.push({ step: 'delayed_review', ...result, stateAfter: state.readiness.find(p => p.conceptId === target) });
    const maintenance = r.reviews.queue(courseId).upcoming.find(i => i.conceptId === target && i.kind === 'maintenance')!;
    assert(maintenance);
    time = Date.parse(maintenance.dueAt);
    let next = (await r.reviews.next(courseId, reviewGenerator)).item!;
    for (let guard = 0; next.id !== maintenance.id && guard < 100; guard++) {
        await r.reviews.answer(courseId, next.id, { response: 'alpha' }, evaluator);
        next = (await r.reviews.next(courseId, reviewGenerator)).item!;
    }
    assert.equal(next.id, maintenance.id);
    const maintained = await r.reviews.answer(courseId, next.id, { response: 'alpha' }, evaluator);
    assert.equal(maintained.outcome, 'qualifying_success');
    const future = r.store.reviews.list(courseId).find(i => i.conceptId === target && i.status === 'scheduled')!;
    events.push({ step: 'maintenance_success', ...maintained, next: future });
    // A wrong submitted answer is distinct from correcting an earlier evaluation.
    const actualRoot = join(root, 'actual-failure-branch');
    mkdirSync(join(actualRoot, '_learning'), { recursive: true });
    const successful = new DatabaseSync(join(root, '_learning/learning.db'), { readOnly: true });
    try { await backup(successful, join(actualRoot, '_learning/learning.db')); }
    finally { successful.close(); }
    const successfulTime = time;
    const actualFailure = systemRuntime(actualRoot, clock);
    try {
        time = Date.parse(future.dueAt);
        let selected = (await actualFailure.reviews.next(courseId, reviewGenerator)).item!;
        for (let guard = 0; selected.id !== future.id && guard < 100; guard++) {
            await actualFailure.reviews.answer(courseId, selected.id, { response: 'alpha' }, evaluator);
            selected = (await actualFailure.reviews.next(courseId, reviewGenerator)).item!;
        }
        assert.equal(selected.id, future.id);
        const failed = await actualFailure.reviews.answer(courseId, selected.id, { response: 'beta' }, evaluator);
        const failedState = actualFailure.state.refresh(courseId);
        assert.equal(actualFailure.evaluations.heads(courseId, failed.item.attemptId!)[0]!.correctness, 0);
        assert.notEqual(failedState.readiness.find(p => p.conceptId === target)!.stage, 'durable_mastery');
        assert(failedState.gaps.some(g => g.conceptId === target && g.status === 'OPEN'));
        time += 365 * day;
        assert.equal(actualFailure.state.refresh(courseId).id, failedState.id);
        assert(!actualFailure.reviews.queue(courseId).upcoming.some(i => i.conceptId === target && i.kind === 'maintenance'));
        events.push({ step: 'actual_maintenance_failure', attemptId: failed.item.attemptId, outcome: failed.outcome, stateRevisionId: failedState.id, clockAloneDoesNotRestore: true });
    } finally { actualFailure.store.close(); time = successfulTime; }
    // A separate copied branch proves failure/correction without altering successful acceptance history.
    const failureRoot = join(root, 'failure-branch');
    mkdirSync(join(failureRoot, '_learning'), { recursive: true });
    const source = new DatabaseSync(join(root, '_learning/learning.db'), { readOnly: true });
    try {
        await backup(source, join(failureRoot, '_learning/learning.db'));
    }
    finally {
        source.close();
    }
    const failure = systemRuntime(failureRoot, clock);
    try {
        const originalHead = failure.evaluations.heads(courseId, maintained.item.attemptId!)[0]!;
        const correction = failure.evaluations.record(courseId, maintained.item.attemptId!, 'synthetic-m9-maintenance-correction', { kind: 'human', name: 'synthetic-development-reviewer', version: '1', policyVersion: 'synthetic-m9-v1' }, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'SYNTHETIC corrected maintenance failure.' }, originalHead.id);
        failure.reviews.refresh(courseId);
        assert.equal(failure.reviews.get(courseId, future.id).status, 'superseded');
        assert.notEqual(failure.state.refresh(courseId).readiness.find(p => p.conceptId === target)!.stage, 'durable_mastery');
        events.push({ step: 'separate_maintenance_failure_branch', attemptId: maintained.item.attemptId, oldEvaluationId: originalHead.id, correctedEvaluationId: correction.evaluation.id, supersededFutureId: future.id, gaps: failure.state.refresh(courseId).gaps.filter(g => g.conceptId === target) });
    }
    finally {
        failure.store.close();
    }
    const auditId = r.store.assessments.evidenceForAttempt(courseId, maintained.item.attemptId!)[0]!.id, audit = r.evidence.show(courseId, auditId);
    events.push({ step: 'read_only_audit', evidenceId: auditId, taskId: audit.task.id, attemptId: audit.attempt.id, evaluationId: audit.evaluation.id, curriculumVersion: audit.task.curriculumVersion, sourceRefs: audit.task.sourceRefs, researchRefs: audit.task.researchRefs });
    const doctor = r.store.health.diagnose(courseId);
    assert.equal(doctor.integrity, 'ok');
    assert.equal(doctor.foreignKeyViolations, 0);
    assert.equal(doctor.migrationHistory, 'valid');
    const verifier = new DatabaseSync(join(root, '_learning/learning.db'), { readOnly: true });
    try {
        assert.deepEqual(verifier.prepare('SELECT * FROM schema_migrations WHERE version<=? ORDER BY version').all(originalLedger.length), originalLedger);
    }
    finally {
        verifier.close();
    }
    assert.equal(digest(), before);
    writeFileSync(join(root, 'report.json'), JSON.stringify({ label: 'ALL PERFORMANCE IS SYNTHETIC DEVELOPMENT DATA. This validates integration/provenance, not subject-task validity, pedagogical optimality or real learner ability.', mode, courseId, target, version: graph.version, originalDatabaseUnchanged: true, events, doctor }, null, 2), 'utf8');
    console.log(JSON.stringify({ mode, courseId, target, diagnostic: diagnosticFinal.status, teaching: finalTeaching.status, stage: state.readiness.find(p => p.conceptId === target)!.stage, report: join(root, 'report.json'), result: 'passed' }));
}
finally {
    r.store.close();
}
