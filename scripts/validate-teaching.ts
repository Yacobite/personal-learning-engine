/** Private acceptance content is supplied separately under ignored _learning/. */
import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { TeachingService } from '../src/services/teaching-service.ts';
import { TeachingContextBuilder } from '../src/services/teaching-context.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import type { TeachingContentGenerator } from '../src/ports/teaching-generator.ts';
type Lesson = {
    coreIdea: string;
    formalStatement: string;
    example: string;
    nonExample: string;
    hints: string[];
    checks: {
        prompt: string;
        expected: string;
    }[];
    transfer: {
        prompt: string;
        expected: string;
    };
    rubric: string;
};
const [catalogPath] = process.argv.slice(2);
if (!catalogPath)
    throw Error('Supply an ignored private acceptance catalog.');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    workspace: string;
    courseId: string;
    targets: Record<string, string>;
    lessons: Record<string, Lesson>;
};
const original = resolve(catalog.workspace, '_learning', 'learning.db');
const digest = () => createHash('sha256').update(readFileSync(original)).digest('hex');
const before = digest();
const directory = resolve('_learning', 'm6-acceptance');
mkdirSync(directory, { recursive: true });
const run = mkdtempSync(join(directory, 'run-'));
const reports: unknown[] = [];
for (const [profile, target] of Object.entries(catalog.targets)) {
    const root = join(run, profile);
    mkdirSync(join(root, '_learning'), { recursive: true });
    const reader = new DatabaseSync(original, { readOnly: true });
    try {
        await backup(reader, join(root, '_learning', 'learning.db'));
    }
    finally {
        reader.close();
    }
    const store = openLearningDatabase(root);
    try {
        const id = (prefix: string) => `${prefix}-${randomUUID()}`;
        const hash = (v: string) => createHash('sha256').update(v).digest('hex');
        const clock = () => new Date();
        const courses = new CourseService(store.courses, () => id('course'), clock);
        const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => id('concept'), clock);
        const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, id, hash, clock);
        const evaluations = new EvaluationService(assessments, store.assessments, id, hash, clock);
        const context = new TeachingContextBuilder(store.sources, store.research);
        const teaching = new TeachingService(store.teaching, store.diagnostics, store.assessments, graphs, assessments, evaluations, context, id, clock);
        const handoff = teaching.start(catalog.courseId);
        const diagnosticHandoff = { diagnosticId: handoff.diagnosticId, recommendations: handoff.recommendations };
        teaching.abandon(catalog.courseId);
        const session = teaching.start(catalog.courseId, { conceptId: target, budget: 40 });
        const used = new Map<string, number>();
        const grounded: unknown[] = [];
        const generator: TeachingContentGenerator = { propose: async (c) => {
                const lesson = catalog.lessons[c.grounding.conceptId];
                if (!lesson)
                    throw Error('Private reviewed lesson missing for selected concept.');
                grounded.push(c.grounding);
                const interactive = !['explain', 'scaffold'].includes(c.moveType);
                let task: unknown = null;
                if (interactive) {
                    if (c.moveType === 'teach_back')
                        task = { prompt: `Explain ${c.grounding.title} in your own words, including a condition and an example.`, scoring: { kind: 'open', rubricVersion: 'private-reviewed-v1', criteria: [{ key: 'meaning', description: lesson.rubric }], expected: null } };
                    else {
                        const key = c.grounding.conceptId;
                        const index = used.get(key) ?? 0;
                        used.set(key, index + 1);
                        const check = c.moveType === 'near_transfer' ? lesson.transfer : lesson.checks[index % lesson.checks.length]!;
                        task = { prompt: check.prompt, scoring: { kind: 'text', expected: check.expected, normalization: 'trim' } };
                    }
                }
                return { components: interactive ? {} : c.moveType === 'explain' ? { coreIdea: lesson.coreIdea, formalStatement: lesson.formalStatement, example: lesson.example, nonExample: lesson.nonExample } : { coreIdea: lesson.hints[c.level - 1] }, task, sourceRefs: c.grounding.source.map(s => s.ref), researchRefs: c.grounding.research.map(s => s.ref) };
            } };
        const responses: unknown[] = [];
        let targetAnswers = 0;
        for (let guard = 0; guard < 80; guard++) {
            const n = await teaching.next(catalog.courseId, generator);
            if (!n.move)
                break;
            const m = n.move;
            if (!m.taskId)
                continue;
            const task = assessments.task(catalog.courseId, m.taskId);
            let response = task.scoring.kind === 'text' ? task.scoring.expected : 'Synthetic own-words explanation: ' + catalog.lessons[m.conceptId]!.coreIdea;
            if (m.conceptId === target && m.type !== 'teach_back') {
                targetAnswers++;
                if ((profile === 'B' && targetAnswers === 1) || (profile === 'C' && targetAnswers <= 2) || (profile === 'D' && targetAnswers === 1))
                    response = 'Synthetic deliberately incorrect response.';
            }
            if (profile === 'D' && m.conceptId === target && targetAnswers === 2) {
                for (let h = m.level + 1; h <= 4; h++)
                    await teaching.hint(catalog.courseId, generator);
            }
            const resolved = await teaching.answer(catalog.courseId, m.id, { response }, new DeterministicEvaluator());
            responses.push({ moveId: m.id, response, attemptId: resolved.attemptId, outcomes: resolved.outcomes });
        }
        const completed = teaching.get(catalog.courseId, session.id);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.summary!.stopReason, 'instructional_goal_reached');
        if (profile === 'C') {
            assert(completed.summary!.moves.some(m => m.reason === 'prerequisite_backtrack'));
            assert(completed.summary!.moves.some(m => m.reason === 'return_to_original_concept'));
        }
        if (profile === 'D')
            assert(completed.summary!.moves.some(m => m.level === 4));
        reports.push({ label: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA. Reviewed local content, not a live model-quality acceptance.', profile, courseId: catalog.courseId, curriculumVersion: session.curriculumVersion, diagnosticHandoff, explicitTarget: target, grounded, responses, audit: teaching.audit(catalog.courseId, session.id) });
    }
    finally {
        store.close();
    }
}
assert.equal(digest(), before);
writeFileSync(join(run, 'report.json'), JSON.stringify({ originalDatabaseUnchanged: true, reports }, null, 2));
console.log(JSON.stringify({ profiles: Object.keys(catalog.targets), report: join(run, 'report.json'), originalDatabaseUnchanged: true }));
