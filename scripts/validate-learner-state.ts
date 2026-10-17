import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { LearnerStateService } from '../src/services/learner-state-service.ts';
import { ReadinessService } from '../src/services/readiness-service.ts';
import { competenceProfile } from '../src/domain/competence-profile.ts';
import { verificationDelayMs } from '../src/domain/learner-state.ts';
import type { Dimension } from '../src/domain/learner-state.ts';
import type { AssessmentTask } from '../src/domain/assessment.ts';
const [workspace, courseId, mode = 'logic'] = process.argv.slice(2);
if (!workspace || !courseId || !['logic', 'python'].includes(mode))
    throw Error('Usage: node scripts/validate-learner-state.ts <M6-workspace> <course-id> [logic|python]');
const original = resolve(workspace, '_learning', 'learning.db');
const digest = () => createHash('sha256').update(readFileSync(original)).digest('hex');
const before = digest();
const directory = resolve('_learning', 'm7-acceptance');
mkdirSync(directory, { recursive: true });
const run = mkdtempSync(join(directory, 'run-'));
const reports: unknown[] = [];
for (const profile of mode === 'logic' ? ['A', 'B', 'C', 'D', 'E', 'F'] : ['C', 'D']) {
    const root = join(run, profile);
    mkdirSync(join(root, '_learning'), { recursive: true });
    const reader = new DatabaseSync(original, { readOnly: true });
    let oldLedger: unknown;
    try {
        oldLedger = reader.prepare('SELECT * FROM schema_migrations').all();
        assert.equal((oldLedger as unknown[]).length, 7);
        await backup(reader, join(root, '_learning', 'learning.db'));
    }
    finally {
        reader.close();
    }
    const store = openLearningDatabase(root);
    try {
        const clockState = { time: Date.parse('2040-01-01T00:00:00.000Z') };
        const clock = () => new Date(clockState.time);
        const id = (prefix: string) => prefix + '-' + randomUUID();
        const hash = (value: string) => createHash('sha256').update(value).digest('hex');
        const courses = new CourseService(store.courses, () => id('course'), clock);
        const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => id('concept'), clock);
        const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, id, hash, clock);
        const evaluations = new EvaluationService(assessments, store.assessments, id, hash, clock);
        const state = new LearnerStateService(store.learnerState, store.learnerLedger, graphs, id, hash, clock);
        const readiness = new ReadinessService(state);
        const graph = graphs.get(courseId);
        const originalBasis = store.learnerLedger.read(courseId, clock().toISOString());
        const seen = new Set(originalBasis.flatMap(r => r.task.conceptIds));
        const target = graph.nodes.find(n => n.type === 'concept' && !seen.has(n.conceptId));
        if (!target)
            throw Error('Acceptance requires an existing stable concept without baseline performance. No baseline evidence is deleted.');
        const oldGraph = graphs.get(courseId, 1);
        assert(oldGraph.nodes.some(n => n.conceptId === target.conceptId));
        const required = competenceProfile(target.type)!;
        const primary = required[0]!;
        const stages: unknown[] = [];
        let sequence = 0;
        const snapshot = (label: string) => { const revision = state.refresh(courseId); stages.push({ label, revisionId: revision.id, asOf: revision.asOf, readiness: revision.readiness.find(r => r.conceptId === target.conceptId), dimensions: revision.dimensions.filter(d => d.conceptId === target.conceptId), gaps: revision.gaps.filter(g => g.conceptId === target.conceptId) }); return revision; };
        const add = (dims: readonly Dimension[], correctness: number, options: {
            assistance?: 'none' | 'minimal' | 'guided' | 'worked_solution' | 'ai_performed';
            task?: AssessmentTask;
            at?: number;
        } = {}) => {
            clockState.time = options.at ?? clockState.time + 1000;
            sequence++;
            const task = options.task ?? assessments.createTask(courseId, { curriculumVersion: 1, conceptIds: [target.conceptId], type: dims.includes('transfer') ? 'near_transfer' : dims.includes('structural_understanding') ? 'self_explanation' : 'cued_recall', intendedDimensions: dims, representation: sequence % 2 ? 'text' : 'mixed', novelty: dims.includes('transfer') ? 'near_transfer' : 'isomorphic', origin: 'manual', prompt: 'SYNTHETIC DEVELOPMENT PERFORMANCE SNAPSHOT ' + profile + ' ' + sequence + '. Explicit synthetic rubric outcome, not a claim about the real learner.', scoring: { kind: 'open', rubricVersion: 'synthetic-m7-v1', criteria: dims.map(d => ({ key: d, description: 'Synthetic ' + d + ' observation supplied for projection acceptance.' })), expected: null }, sourceRefs: [], researchRefs: [] });
            const assistance = options.assistance ?? 'none';
            const attempt = assessments.submit(courseId, 'synthetic-m7:attempt:' + profile + ':' + sequence, { taskId: task.id, response: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', assistance, hints: { count: assistance === 'none' || assistance === 'ai_performed' ? 0 : 1, highestLevel: assistance === 'ai_performed' ? 'none' : assistance, notes: null } });
            const evaluation = evaluations.record(courseId, attempt.id, 'synthetic-m7:evaluation:' + profile + ':' + sequence, { kind: 'human', name: 'synthetic-development-fixture', version: '1', policyVersion: 'synthetic-m7-v1' }, { status: 'scored', correctness, rubricScores: {}, rationale: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.' });
            return { task, attempt, ...evaluation };
        };
        snapshot('baseline');
        if (profile === 'A') {
            add([primary], 1);
            snapshot('same-session-only');
        }
        else if (profile === 'B') {
            add(required, 1, { assistance: 'guided' });
            snapshot('assisted-only');
        }
        else {
            const immediate = add(required, 1);
            snapshot('broad-immediate');
            if (profile === 'D') {
                add([primary], 1, { at: Date.parse(immediate.attempt.submittedAt) + verificationDelayMs });
                snapshot('concept-delayed');
            }
            if (profile === 'E' || profile === 'F') {
                const failed = add([primary], 0);
                snapshot('gap-open');
                add([primary], 1, { task: failed.task });
                snapshot('same-item-repair');
                const parallel = add([primary], 1);
                snapshot('changed-case-awaiting');
                add([primary], 1, { at: Date.parse(parallel.attempt.submittedAt) + verificationDelayMs });
                snapshot('delayed-gap-closed');
                if (profile === 'F') {
                    add([primary], 0);
                    snapshot('recurrent-failure');
                }
            }
        }
        const originalIds = new Set(originalBasis.map(r => r.attempt.id));
        assert.deepEqual(store.learnerLedger.read(courseId, clock().toISOString()).filter(r => originalIds.has(r.attempt.id)), originalBasis);
        const final = state.refresh(courseId);
        const report = final.readiness.find(r => r.conceptId === target.conceptId)!;
        const gap = final.gaps.filter(g => g.conceptId === target.conceptId);
        if (profile === 'A' || profile === 'B')
            assert.notEqual(report.stage, 'durable_mastery');
        if (profile === 'C')
            assert.equal(report.stage, 'provisional_competence');
        if (profile === 'D' || profile === 'E')
            assert.equal(report.stage, 'durable_mastery');
        if (profile === 'E')
            assert(gap.every(g => g.status === 'VERIFIED_CLOSED'));
        if (profile === 'F') {
            assert.equal(gap.length, 2);
            assert.equal(gap[1]!.recursFrom, gap[0]!.id);
            assert.notEqual(report.stage, 'durable_mastery');
        }
        assert(final.observations.filter(o => o.conceptIds.includes(target.conceptId)).every(o => o.originalVersion === 1));
        assert.equal(final.curriculumVersion, graph.version);
        const verifier = new DatabaseSync(join(root, '_learning', 'learning.db'), { readOnly: true });
        try {
            assert.deepEqual(verifier.prepare('SELECT * FROM schema_migrations WHERE version<=7').all(), oldLedger);
            assert.deepEqual(verifier.prepare('PRAGMA foreign_key_check').all(), []);
        }
        finally {
            verifier.close();
        }
        reports.push({ label: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', profile, courseId, curriculumVersion: graph.version, concept: { id: target.conceptId, title: target.title, type: target.type }, profileRequirements: required, policies: final.policies, originalCurriculumEvidenceVersion: 1, baselineM4Preserved: true, stages, courseReadiness: readiness.courseReport(courseId) });
        console.log(JSON.stringify({ profile, courseId, conceptId: target.conceptId, stage: report.stage, gaps: gap.map(g => g.status) }));
    }
    finally {
        store.close();
    }
}
assert.equal(digest(), before);
writeFileSync(join(run, 'report.json'), JSON.stringify({ label: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', originalDatabaseUnchanged: true, reports }, null, 2));
console.log('Private acceptance report: ' + join(run, 'report.json'));
