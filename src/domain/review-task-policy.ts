import type { AssessmentTask } from './assessment.ts';
import type { Dimension, LearnerStateRevision, ReadinessResult } from './learner-state.ts';
import type { ReviewConstraints, ReviewItem, ReviewKind } from './review.ts';
const types: Partial<Record<Dimension, AssessmentTask['type']>> = {
    memory_accessibility: 'cued_recall', structural_understanding: 'error_diagnosis', discrimination: 'discrimination',
    application: 'prediction', transfer: 'near_transfer', representation_flexibility: 'representation_conversion',
    procedural_fluency: 'procedure', scaffold_independence: 'procedure',
};
export function taskConstraints(state: LearnerStateRevision, report: ReadinessResult, kind: ReviewKind, history: readonly ReviewItem[], gapDimension?: Dimension): ReviewConstraints | undefined {
    const eligible = gapDimension ? [gapDimension] : report.requiredDimensions.filter(d => d !== 'calibration' && (kind !== 'delayed_verification'
        || state.dimensions.some(s => s.conceptId === report.conceptId && s.dimension === d && ['provisional_support', 'durable_support'].includes(s.band) && !s.lastDelayedSuccess)));
    const states = state.dimensions.filter(s => s.conceptId === report.conceptId);
    const ordered = eligible.filter(d => types[d]).sort((a, b) => {
        const x = states.find(s => s.dimension === a), y = states.find(s => s.dimension === b);
        return (x?.lastIndependentSuccess ?? '').localeCompare(y?.lastIndependentSuccess ?? '')
            || (x?.independentSuccessCount ?? 0) - (y?.independentSuccessCount ?? 0)
            || (['transfer', 'representation_flexibility'].includes(b) ? 1 : 0) - (['transfer', 'representation_flexibility'].includes(a) ? 1 : 0)
            || a.localeCompare(b);
    });
    const dimension = ordered[0];
    if (!dimension)
        return undefined;
    const prior = history.filter(i => i.conceptId === report.conceptId && i.dimension === dimension && i.status === 'completed').at(-1);
    // Mixed is a requested changed format, not a claim of cross-representation competence.
    const representation = prior?.representation === 'mixed' ? 'text' : prior ? 'mixed' : dimension === 'representation_flexibility' ? 'mixed' : 'text';
    return { dimension, type: types[dimension]!, representation, novelty: dimension === 'transfer' ? 'near_transfer' : 'isomorphic', assistance: 'none' };
}
