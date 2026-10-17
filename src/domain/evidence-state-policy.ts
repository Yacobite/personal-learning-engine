import { dimensions, noveltyTypes } from './assessment.ts';
import { evidenceRef, learnerPolicies, verificationDelayMs } from './learner-state.ts';
import type { PerformanceRecord, Observation, Dimension, DimensionState, GapSnapshot, DelayedState } from './learner-state.ts';
export function observations(records: readonly PerformanceRecord[], asOf: string, hash: (text: string) => string): Observation[] {
    const result = records.filter(r => r.attempt.submittedAt <= asOf).map(r => {
        const evaluations = r.evaluations.filter(e => e.createdAt <= asOf);
        const parents = new Set(evaluations.map(e => e.supersedes));
        const heads = evaluations.filter(e => !parents.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
        const a = r.attempt;
        return { attemptId: a.id, taskId: r.task.id, originalVersion: r.task.curriculumVersion, conceptIds: [...r.task.conceptIds].sort(), dimensions: [...r.task.intendedDimensions].sort(),
            type: r.task.type, at: a.submittedAt, assistance: a.assistance, hints: { count: a.hints.count, highestLevel: a.hints.highestLevel }, novelty: r.task.novelty, representation: r.task.representation,
            repeatedCase: false, promptHash: hash(r.task.prompt.trim().replace(/\s+/g, ' ')), confidence: a.confidence ?? null, heads,
            independent: a.assistance === 'none' && a.hints.count === 0 && a.hints.highestLevel === 'none',
            ambiguous: r.task.conceptIds.length !== 1 || heads.length > 1, correctness: heads.length === 1 && heads[0]!.status === 'scored' ? heads[0]!.correctness : null };
    }).sort((a, b) => a.at.localeCompare(b.at) || a.attemptId.localeCompare(b.attemptId));
    for (const [index, o] of result.entries()) o.repeatedCase = result.slice(0, index).some(p => p.conceptIds.some(id => o.conceptIds.includes(id)) && (p.taskId === o.taskId || p.promptHash === o.promptHash));
    return result;
}
export function targets(o: Observation, dimension: Dimension): boolean {
    if (dimension === 'calibration')
        return o.confidence !== null;
    if (dimension === 'scaffold_independence')
        return true;
    return o.dimensions.includes(dimension);
}
/** These are transparent metadata gates, not a semantic evaluator. */
export function attributable(o: Observation, dimension: Dimension): boolean {
    return !o.ambiguous && o.assistance !== 'ai_performed' && dimension !== 'calibration' && targets(o, dimension)
        && (dimension !== 'transfer' || ['near_transfer', 'far_transfer', 'authentic'].includes(o.novelty) && (o.correctness !== 1 || !o.repeatedCase));
}
export function scored(o: Observation): boolean { return o.heads.length === 1 && o.heads[0]!.status === 'scored' && o.heads[0]!.evidenceId !== null && (o.correctness === 0 || o.correctness === 1); }
export function freshCase(o: Observation, previous: readonly Observation[]): boolean {
    return o.novelty !== 'repeated' && !previous.some(p => p.taskId === o.taskId || p.promptHash === o.promptHash);
}
export function delayedState(items: readonly Observation[], relevant: readonly Dimension[]): DelayedState {
    const independent = items.filter(o => o.independent && scored(o) && relevant.some(d => attributable(o, d)));
    const successes = independent.filter(o => o.correctness === 1);
    const failure = independent.filter(o => o.correctness === 0).at(-1);
    let verified: Observation | undefined;
    let baseline: Observation | undefined;
    for (const success of successes) {
        const prior = successes.find(p => p.attemptId !== success.attemptId && Date.parse(success.at) - Date.parse(p.at) >= verificationDelayMs);
        if (prior && (!failure || items.indexOf(success) > items.indexOf(failure)) && freshCase(success, items.slice(0, items.indexOf(success)))) {
            verified = success;
            baseline = prior;
        }
    }
    if (verified)
        return { status: 'satisfied', eligibleAfter: new Date(Date.parse(baseline!.at) + verificationDelayMs).toISOString(), baselineAttemptId: baseline!.attemptId, verifiedAttemptId: verified.attemptId };
    const first = successes.filter(o => !failure || items.indexOf(o) > items.indexOf(failure))[0];
    return first ? { status: 'waiting_for_delayed_evidence', eligibleAfter: new Date(Date.parse(first.at) + verificationDelayMs).toISOString(), baselineAttemptId: first.attemptId, verifiedAttemptId: null }
        : { status: 'no_prior_independent_success', eligibleAfter: null, baselineAttemptId: null, verifiedAttemptId: null };
}
export function dimensionStates(conceptId: string, items: readonly Observation[], gaps: readonly GapSnapshot[]): DimensionState[] {
    return dimensions.map(dimension => {
        const relevant = items.filter(o => targets(o, dimension));
        const qualified = relevant.filter(o => attributable(o, dimension) && scored(o));
        const independent = qualified.filter(o => o.independent);
        const success = independent.filter(o => o.correctness === 1), failure = independent.filter(o => o.correctness === 0);
        const assisted = qualified.filter(o => !o.independent);
        const assistedSuccess = assisted.filter(o => o.correctness === 1), assistedFailure = assisted.filter(o => o.correctness === 0);
        const open = gaps.filter(g => g.dimension === dimension && g.status !== 'VERIFIED_CLOSED');
        const delayed = delayedState(items, [dimension]);
        let band: DimensionState['band'] = 'untested';
        if (independent.at(-1)?.correctness === 0)
            band = 'independent_difficulty';
        else if (success.length)
            band = failure.length && open.some(g => g.status === 'OPEN' || g.status === 'REPAIR_IN_PROGRESS') ? 'mixed'
                : delayed.status === 'satisfied' && !open.length ? 'durable_support' : 'provisional_support';
        else if (assisted.at(-1)?.correctness === 0)
            band = 'assisted_difficulty';
        else if (assistedSuccess.length)
            band = 'assisted_only';
        const refs = (list: readonly Observation[]) => list.map(evidenceRef).filter((r): r is NonNullable<typeof r> => r !== null);
        const successful = qualified.filter(o => o.correctness === 1);
        const highest = successful.map(o => o.novelty).sort((a, b) => noveltyTypes.indexOf(b) - noveltyTypes.indexOf(a))[0] ?? null;
        return { conceptId, dimension, band, policy: learnerPolicies.evidence, qualifyingCount: qualified.length, independentSuccessCount: success.length, independentFailureCount: failure.length,
            assistedSuccessCount: assistedSuccess.length, assistedFailureCount: assistedFailure.length,
            partialCount: relevant.filter(o => !o.ambiguous && o.correctness !== null && o.correctness > 0 && o.correctness < 1).length,
            unscoredCount: relevant.filter(o => o.heads.length === 1 && o.heads[0]!.status === 'unscored').length,
            failedCount: relevant.filter(o => o.heads.length === 1 && o.heads[0]!.status === 'failed').length,
            unevaluatedCount: relevant.filter(o => !o.heads.length).length,
            ambiguousCount: relevant.filter(o => o.ambiguous).length, aiPerformedCount: relevant.filter(o => o.assistance === 'ai_performed').length,
            lastObservation: relevant.at(-1)?.at ?? null, lastQualifyingObservation: qualified.at(-1)?.at ?? null, lastIndependentSuccess: success.at(-1)?.at ?? null, lastIndependentFailure: failure.at(-1)?.at ?? null,
            lastDelayedSuccess: delayed.verifiedAttemptId ? items.find(o => o.attemptId === delayed.verifiedAttemptId)!.at : null,
            highestNovelty: highest, representations: [...new Set(relevant.map(o => o.representation))].sort(),
            supporting: refs(successful), contradictory: refs(qualified.filter(o => o.correctness === 0)), contextual: relevant.filter(o => !qualified.includes(o)).flatMap(o => o.heads.map(h => ({ attemptId: o.attemptId, evaluationId: h.id, evidenceId: h.evidenceId }))),
            confidenceObservations: relevant.filter(o => !o.ambiguous && o.assistance !== 'ai_performed' && o.correctness !== null && o.confidence !== null).map(o => ({ attemptId: o.attemptId, confidence: o.confidence!, correctness: o.correctness! })) };
    });
}
