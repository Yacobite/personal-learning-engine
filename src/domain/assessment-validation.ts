import { AssessmentError, assistanceLevels, dimensions, isAssessmentId, noveltyTypes, currentOrigins, representations, taskTypes } from './assessment.ts';
import type { TaskInput, Submission, ScoringSpec, Normalization, EvaluatorIdentity, EvaluationProposal } from './assessment.ts';
import { isConceptId, requireVersion } from './curriculum.ts';
import { isSourceId } from './source.ts';
import { isResearchId } from './proposal-validation.ts';
function fail(): never { throw new AssessmentError('Invalid assessment shape, bounds or metadata.'); }
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        fail();
    const result = value as Record<string, unknown>;
    if (required.some((key) => !Object.hasOwn(result, key)) || Reflect.ownKeys(result).some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key)))
        fail();
    return result;
}
export function text(value: unknown, max = 4000): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(); }
function list(value: unknown, max: number, min = 0): unknown[] { if (!Array.isArray(value) || value.length > max || value.length < min)
    fail(); return value; }
function unique(value: readonly unknown[]): void { if (new Set(value).size !== value.length)
    fail(); }
function one(value: unknown, allowed: readonly string[]): void { if (typeof value !== 'string' || !allowed.includes(value))
    fail(); }
function score(value: unknown): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    fail(); }
export function normalize(value: string, mode: Normalization): string { return mode === 'exact' ? value : mode === 'trim' ? value.trim() : value.trim().toLowerCase(); }
export function validateScoring(value: unknown): ScoringSpec {
    const base = object(value, ['kind'], ['expected', 'normalization', 'options', 'tolerance', 'duplicates', 'rubricVersion', 'criteria']);
    if (base.kind === 'text') {
        object(value, ['kind', 'expected', 'normalization']);
        text(base.expected);
        one(base.normalization, ['exact', 'trim', 'trim_lowercase']);
    }
    else if (base.kind === 'choice') {
        object(value, ['kind', 'expected', 'options']);
        const options = list(base.options, 50, 2);
        options.forEach((v) => text(v, 200));
        unique(options);
        text(base.expected, 200);
        if (!options.includes(base.expected))
            fail();
    }
    else if (base.kind === 'numeric') {
        object(value, ['kind', 'expected', 'tolerance']);
        if (typeof base.expected !== 'number' || !Number.isFinite(base.expected) || typeof base.tolerance !== 'number' || !Number.isFinite(base.tolerance) || base.tolerance < 0)
            fail();
    }
    else if (base.kind === 'set') {
        object(value, ['kind', 'expected', 'normalization', 'duplicates']);
        one(base.normalization, ['exact', 'trim', 'trim_lowercase']);
        one(base.duplicates, ['ignore', 'reject']);
        const expected = list(base.expected, 100);
        expected.forEach((v) => text(v, 200));
        if (base.duplicates === 'reject')
            unique((expected as string[]).map((v) => normalize(v, base.normalization as Normalization)));
    }
    else if (base.kind === 'open') {
        object(value, ['kind', 'expected', 'rubricVersion', 'criteria']);
        text(base.rubricVersion, 100);
        if (base.expected !== null)
            text(base.expected);
        const keys = list(base.criteria, 20).map((v) => { const c = object(v, ['key', 'description']); text(c.key, 60); text(c.description, 2000); if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.key) || ['__proto__', 'prototype', 'constructor'].includes(c.key))
            fail(); return c.key; });
        unique(keys);
    }
    else
        fail();
    return JSON.parse(JSON.stringify(value)) as ScoringSpec;
}
export function validateTask(value: unknown): TaskInput {
    const v = object(value, ['conceptIds', 'type', 'intendedDimensions', 'representation', 'novelty', 'origin', 'prompt', 'scoring', 'sourceRefs', 'researchRefs'], ['curriculumVersion']);
    if (v.curriculumVersion !== undefined)
        requireVersion(Number(v.curriculumVersion));
    if (v.curriculumVersion !== undefined && typeof v.curriculumVersion !== 'number')
        fail();
    const concepts = list(v.conceptIds, 20, 1);
    concepts.forEach((id) => { if (typeof id !== 'string' || !isConceptId(id))
        fail(); });
    unique(concepts);
    const dims = list(v.intendedDimensions, 9, 1);
    dims.forEach((d) => one(d, dimensions));
    unique(dims);
    one(v.type, taskTypes);
    one(v.representation, representations);
    one(v.novelty, noveltyTypes);
    one(v.origin, currentOrigins);
    if (v.origin === 'review_generated' && !((v.sourceRefs as unknown[])?.length || (v.researchRefs as unknown[])?.length)) fail();
    text(v.prompt, 16000);
    validateScoring(v.scoring);
    const refs = list(v.sourceRefs, 20);
    refs.forEach((x) => { const r = object(x, ['sourceId', 'version', 'segmentId']); if (typeof r.sourceId !== 'string' || !isSourceId(r.sourceId) || !Number.isSafeInteger(r.version) || Number(r.version) < 1 || typeof r.segmentId !== 'string' || r.segmentId.length > 100 || !new RegExp(`^${r.sourceId}@${r.version}:\\d+$`).test(r.segmentId))
        fail(); });
    unique(refs.map((r) => (r as {
        segmentId: string;
    }).segmentId));
    const research = list(v.researchRefs, 20);
    research.forEach((x) => { const r = object(x, ['briefId', 'referenceId']); if (typeof r.briefId !== 'string' || !isResearchId(r.briefId, 'brief') || typeof r.referenceId !== 'string' || !isResearchId(r.referenceId, 'reference'))
        fail(); });
    unique(research.map((r) => (r as {
        referenceId: string;
    }).referenceId));
    if (v.origin === 'source_derived' && !refs.length)
        fail();
    return JSON.parse(JSON.stringify(value)) as TaskInput;
}
export function validateSubmission(value: unknown): Submission {
    const v = object(value, ['taskId', 'response', 'assistance', 'hints'], ['confidence', 'latencyMs', 'runtimeRef']);
    if (!isAssessmentId(v.taskId, 'task'))
        fail();
    // A deliberately blank submission is still an actual response, preserved verbatim.
    if (typeof v.response !== 'string' || v.response.length > 32000)
        fail();
    one(v.assistance, assistanceLevels);
    const hints = object(v.hints, ['count', 'highestLevel', 'notes']);
    one(hints.highestLevel, assistanceLevels);
    if (!Number.isSafeInteger(hints.count) || Number(hints.count) < 0 || Number(hints.count) > 100 || (hints.count === 0) !== (hints.highestLevel === 'none') || assistanceLevels.indexOf(hints.highestLevel as never) > assistanceLevels.indexOf(v.assistance as never))
        fail();
    if (hints.notes !== null)
        text(hints.notes, 2000);
    if (v.confidence !== undefined)
        score(v.confidence);
    if (v.latencyMs !== undefined && (typeof v.latencyMs !== 'number' || !Number.isFinite(v.latencyMs) || v.latencyMs < 0 || v.latencyMs > 86400000))
        fail();
    if (v.runtimeRef !== undefined)
        text(v.runtimeRef, 200);
    return JSON.parse(JSON.stringify(value)) as Submission;
}
export function validateIdentity(value: unknown): EvaluatorIdentity {
    const v = object(value, ['kind', 'name', 'version', 'policyVersion'], ['provider', 'model']);
    one(v.kind, ['deterministic', 'llm', 'human']);
    text(v.name, 100);
    text(v.version, 100);
    text(v.policyVersion, 100);
    if (v.provider !== undefined)
        text(v.provider, 100);
    if (v.model !== undefined)
        text(v.model, 100);
    if (v.kind !== 'llm' && (v.provider !== undefined || v.model !== undefined))
        fail();
    return JSON.parse(JSON.stringify(value)) as EvaluatorIdentity;
}
export function validateEvaluation(value: unknown, scoring: ScoringSpec): EvaluationProposal {
    const v = object(value, ['status', 'correctness', 'rubricScores', 'rationale']);
    one(v.status, ['scored', 'unscored', 'failed']);
    text(v.rationale, 4000);
    const keys = scoring.kind === 'open' ? scoring.criteria.map((c) => c.key) : [];
    const scores = object(v.rubricScores, [], keys);
    Object.values(scores).forEach(score);
    if (v.status === 'scored') {
        score(v.correctness);
        if (v.correctness !== 0 && v.correctness !== 1 && (!keys.length || Object.keys(scores).length !== keys.length))
            fail();
    }
    else if (v.correctness !== null || Object.keys(scores).length)
        fail();
    return JSON.parse(JSON.stringify(value)) as EvaluationProposal;
}
export function operationId(value: string): void { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,119}$/.test(value))
    fail(); }
/** Stable field ordering, preserving array order and the exact submitted response. */
export function canonical(value: unknown): string {
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
    return JSON.stringify(value);
}
