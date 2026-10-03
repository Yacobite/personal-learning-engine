import { canonical, object, text, validateTask } from '../domain/assessment-validation.ts';
import type { TaskInput } from '../domain/assessment.ts';
import { TeachingError } from '../domain/teaching.ts';
import type { TeachingContent } from '../domain/teaching.ts';
import type { TeachingContext } from '../ports/teaching-generator.ts';
export function teachingContent(context: TeachingContext, value: unknown): {
    content: TeachingContent;
    task: TaskInput | null;
} {
    const p = object(value, ['components', 'task', 'sourceRefs', 'researchRefs']);
    const components = object(p.components, [], ['coreIdea', 'intuition', 'formalStatement', 'example', 'nonExample', 'confusion', 'prerequisiteConnection']);
    for (const v of Object.values(components))
        text(v, 1200);
    if (JSON.stringify(components).length > 5000)
        throw new TeachingError('Teaching content exceeds the bounded explanation limit.');
    const g = context.grounding;
    const allowedSources = new Set(g.source.map(s => canonical(s.ref)));
    const allowedResearch = new Set(g.research.map(s => canonical(s.ref)));
    if (!Array.isArray(p.sourceRefs) || !Array.isArray(p.researchRefs) || (!p.sourceRefs.length && !p.researchRefs.length) || p.sourceRefs.some(r => !allowedSources.has(canonical(r))) || p.researchRefs.some(r => !allowedResearch.has(canonical(r))))
        throw new TeachingError('Content must cite supplied pinned provenance.');
    const selectedSource = new Set(p.sourceRefs.map(canonical));
    const selectedResearch = new Set(p.researchRefs.map(canonical));
    const content = { components, sourceRefs: p.sourceRefs, researchRefs: p.researchRefs,
        grounding: {
            source: g.source.filter(s => selectedSource.has(canonical(s.ref))).map(s => ({ ref: s.ref, anchor: s.anchor, warnings: s.warnings })),
            research: g.research.filter(s => selectedResearch.has(canonical(s.ref))).map(s => ({ ref: s.ref, url: s.url }))
        }
    } as TeachingContent;
    const interactive = !['explain', 'scaffold'].includes(context.moveType);
    if (!interactive) {
        if (p.task !== null || !Object.keys(components).length)
            throw new TeachingError('Explanation/scaffold needs bounded content and no task.');
        return { content, task: null };
    }
    if (Object.keys(components).length)
        throw new TeachingError('Interactive move must not bundle an explanation before the answer.');
    const t = object(p.task, ['prompt', 'scoring']);
    text(t.prompt, 4000);
    const type = context.moveType === 'teach_back' ? 'self_explanation' : context.moveType === 'near_transfer' ? 'near_transfer' : 'cued_recall';
    const task = validateTask({ ...t, curriculumVersion: g.curriculumVersion, conceptIds: [g.conceptId], type, intendedDimensions: [type === 'near_transfer' ? 'transfer' : type === 'self_explanation' ? 'structural_understanding' : 'memory_accessibility'], representation: g.representation, novelty: context.moveType === 'near_transfer' ? 'near_transfer' : 'isomorphic', origin: g.source.length ? 'source_derived' : 'curriculum_generated', sourceRefs: content.sourceRefs, researchRefs: content.researchRefs });
    if ((task.scoring.kind === 'open') !== (context.moveType === 'teach_back'))
        throw new TeachingError('Only teach-back uses an unscored open rubric.');
    if (/\b(?:answer\s*key|correct\s*answer)\s*:/i.test(task.prompt))
        throw new TeachingError('Interactive prompt contains an answer key.');
    if (context.previousPrompts.some(p => p.trim() === task.prompt.trim()))
        throw new TeachingError('Generate a distinct task; repeated wording cannot count as transfer.');
    return { content, task };
}
