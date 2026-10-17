import { canonical, object, text, validateTask } from '../domain/assessment-validation.ts';
import { ReviewError } from '../domain/review.ts';
import type { ReviewTaskContext } from '../ports/review-generator.ts';
import type { TaskInput } from '../domain/assessment.ts';
export function reviewTask(context: ReviewTaskContext, value: unknown, hash: (s: string) => string): TaskInput {
    const p = object(value, ['prompt', 'scoring', 'sourceRefs', 'researchRefs']);
    text(p.prompt, 4000);
    const g = context.grounding, c = context.item;
    const task = validateTask({ ...p, curriculumVersion: g.curriculumVersion, conceptIds: [g.conceptId], type: c.type, intendedDimensions: [c.dimension],
        representation: c.representation, novelty: c.novelty, origin: 'review_generated' });
    if (task.scoring.kind === 'open')
        throw new ReviewError('no_evaluable_review_task: open-response grading is unavailable.');
    if (c.dimension === 'structural_understanding' && task.scoring.kind === 'text')
        throw new ReviewError('Structural understanding requires a closed structured check, not exact-text explanation grading.');
    const sources = new Set(g.source.map(s => canonical(s.ref))), research = new Set(g.research.map(r => canonical(r.ref)));
    if (task.sourceRefs.some(r => !sources.has(canonical(r))) || task.researchRefs.some(r => !research.has(canonical(r))))
        throw new ReviewError('Review provenance must use supplied stored evidence.');
    if (/\b(?:answer\s*key|correct\s*answer|expected\s*answer)\s*:/i.test(task.prompt))
        throw new ReviewError('Prompt contains an answer-key marker.');
    if (context.previousPromptHashes.includes(hash(task.prompt.trim().replace(/\s+/g, ' '))))
        throw new ReviewError('Duplicate review prompt; retry with a distinct task.');
    return task;
}
