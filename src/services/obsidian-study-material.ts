import { ObsidianError } from '../domain/obsidian.ts';
import type { StudyMaterial } from '../domain/obsidian.ts';
import type { DiagnosticTaskContext } from '../ports/diagnostic-generator.ts';
const strings = ['coreIdea', 'intuition', 'formalStatement', 'example', 'nonExample', 'commonConfusion', 'prerequisiteConnection'];
const arrays = ['keyPoints', 'selfCheckPrompts'];
/** Proposal validation does not infer factual correctness; all content remains untrusted synthesis. */
export function studyMaterial(context: DiagnosticTaskContext, value: unknown): StudyMaterial {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new ObsidianError('Study proposal must be an object.');
    const v = value as Record<string, unknown>;
    if (Reflect.ownKeys(v).some(k => typeof k !== 'string' || ![...strings, ...arrays, 'sourceRefs', 'researchRefs'].includes(k)))
        throw new ObsidianError('Study proposal contains unknown identity/control fields.');
    for (const k of strings)
        if (v[k] !== undefined && (typeof v[k] !== 'string' || !(v[k] as string).trim() || (v[k] as string).length > 4000))
            throw new ObsidianError('Invalid bounded study text.');
    for (const k of arrays)
        if (v[k] !== undefined && (!Array.isArray(v[k]) || (v[k] as unknown[]).length > (k === 'keyPoints' ? 8 : 4) || (v[k] as unknown[]).some(x => typeof x !== 'string' || !x.trim() || x.length > 1000)))
            throw new ObsidianError('Invalid bounded study list.');
    if (!strings.some(k => v[k]) && !arrays.some(k => (v[k] as unknown[] | undefined)?.length))
        throw new ObsidianError('Study proposal has no explanation.');
    for (const [key, allowed, fields] of [['sourceRefs', context.source.map(s => s.ref), ['sourceId', 'version', 'segmentId']], ['researchRefs', context.research.map(r => r.ref), ['briefId', 'referenceId']]] as const) {
        const refs = v[key];
        if (!Array.isArray(refs) || refs.length > 10 || refs.some(r => !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !fields.includes(k as never)) || !allowed.some(a => fields.every(k => r[k] === (a as unknown as Record<string, unknown>)[k]))))
            throw new ObsidianError('Study provenance is outside approved grounding.');
    }
    if (!(v.sourceRefs as unknown[]).length && !(v.researchRefs as unknown[]).length)
        throw new ObsidianError('Study material requires exact provenance.');
    // Control-bearing markup is never executable in exported notes; the renderer also escapes all proposal text.
    for (const text of [...strings.flatMap(k => v[k] ? [v[k]] : []), ...arrays.flatMap(k => (v[k] as unknown[] | undefined) ?? [])])
        if (typeof text === 'string' && /LEARNING_ENGINE:|<script\b|(?:javascript|obsidian|shell|file):\/\//i.test(text))
            throw new ObsidianError('Study material contains unsafe markup/control syntax.');
    return structuredClone(v) as unknown as StudyMaterial;
}
