import { attributable, freshCase, scored } from './evidence-state-policy.ts';
import { evidenceRef, learnerPolicies, verificationDelayMs } from './learner-state.ts';
import type { Dimension, GapIdentity, GapSnapshot, Observation } from './learner-state.ts';
export function gapKey(conceptId: string, dimension: Dimension, attemptId: string): string { return [conceptId, dimension, attemptId, learnerPolicies.gap].join(':'); }
export function gapProjection(courseId: string, conceptId: string, items: readonly Observation[], identity: (conceptId: string, dimension: Dimension, attemptId: string, parent: string | null) => GapIdentity): GapSnapshot[] {
    const gaps: GapSnapshot[] = [];
    for (const o of items)
        for (const dimension of o.dimensions) {
            // Inferred independence/calibration summaries alone do not manufacture gaps.
            if (!attributable(o, dimension) || !scored(o))
                continue;
            const active = gaps.filter(g => g.dimension === dimension).at(-1);
            if (o.correctness === 0) {
                let gap = active;
                if (!gap || gap.status === 'VERIFIED_CLOSED') {
                    gap = { ...identity(conceptId, dimension, o.attemptId, gap?.id ?? null), recursFrom: gap?.id ?? null, status: 'OPEN', transitions: [], awaitingAttemptId: null, eligibleAfter: null };
                    if (gap.courseId !== courseId)
                        throw Error('Gap identity scope mismatch.');
                    gaps.push(gap);
                }
                gap.transitions.push({ status: 'OPEN', at: o.at, reason: gap.status === 'OPEN' ? 'performance_failure' : 'failure_reset', ref: evidenceRef(o)!, assistance: o.assistance });
                gap.status = 'OPEN';
                gap.awaitingAttemptId = null;
                gap.eligibleAfter = null;
                continue;
            }
            if (!active || active.status === 'VERIFIED_CLOSED')
                continue;
            const previous = items.slice(0, items.indexOf(o));
            const changed = o.independent && freshCase(o, previous);
            if (active.status === 'AWAITING_VERIFICATION') {
                const awaiting = items.find(p => p.attemptId === active.awaitingAttemptId)!;
                if (changed && o.attemptId !== awaiting.attemptId && Date.parse(o.at) - Date.parse(awaiting.at) >= verificationDelayMs) {
                    active.status = 'VERIFIED_CLOSED';
                    active.transitions.push({ status: active.status, at: o.at, reason: 'delayed_verification', ref: evidenceRef(o)!, assistance: o.assistance });
                }
                else
                    active.transitions.push({ status: active.status, at: o.at, reason: 'repair_evidence', ref: evidenceRef(o)!, assistance: o.assistance });
            }
            else if (changed) {
                active.status = 'AWAITING_VERIFICATION';
                active.awaitingAttemptId = o.attemptId;
                active.eligibleAfter = new Date(Date.parse(o.at) + verificationDelayMs).toISOString();
                active.transitions.push({ status: active.status, at: o.at, reason: 'changed_independent_case', ref: evidenceRef(o)!, assistance: o.assistance });
            }
            else {
                active.status = 'REPAIR_IN_PROGRESS';
                active.transitions.push({ status: active.status, at: o.at, reason: 'repair_evidence', ref: evidenceRef(o)!, assistance: o.assistance });
            }
        }
    return gaps;
}
