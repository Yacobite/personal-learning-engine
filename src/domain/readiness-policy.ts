import { prerequisiteOrder } from './curriculum.ts';
import type { CurriculumVersion } from './curriculum.ts';
import { competenceProfile } from './competence-profile.ts';
import { delayedState } from './evidence-state-policy.ts';
import type { DimensionState, GapSnapshot, Observation, ReadinessResult } from './learner-state.ts';
export function readinessProjection(graph: CurriculumVersion, states: readonly DimensionState[], gaps: readonly GapSnapshot[], observations: readonly Observation[]): ReadinessResult[] {
    const results = new Map<string, ReadinessResult>();
    for (const conceptId of prerequisiteOrder(graph.nodes.map(n => n.conceptId), graph.edges)) {
        const node = graph.nodes.find(n => n.conceptId === conceptId)!;
        const profile = competenceProfile(node.type);
        const relevant = states.filter(s => s.conceptId === conceptId);
        const applicableGaps = gaps.filter(g => g.conceptId === conceptId && g.status !== 'VERIFIED_CLOSED');
        const missing = (profile ?? []).filter(d => !relevant.some(s => s.dimension === d && ['provisional_support', 'durable_support'].includes(s.band))).map(d => 'independent_support:' + d);
        for (const gap of applicableGaps.filter(g => g.status === 'OPEN' || g.status === 'REPAIR_IN_PROGRESS'))
            missing.push('blocking_gap:' + gap.id);
        const prerequisiteWarnings = graph.edges.filter(e => e.type === 'prerequisite_of' && e.to === conceptId && competenceProfile(graph.nodes.find(n => n.conceptId === e.from)!.type) !== null).filter(e => !['provisional_competence', 'durable_mastery'].includes(results.get(e.from)!.stage) || gaps.some(g => g.conceptId === e.from && ['OPEN', 'REPAIR_IN_PROGRESS'].includes(g.status))).map(e => e.from);
        const items = observations.filter(o => o.conceptIds.includes(conceptId));
        const delayed = delayedState(items, profile ?? []);
        const ambiguity = items.some(o => o.conceptIds.length === 1 && o.heads.length > 1 && (profile ?? []).some(d => o.dimensions.includes(d) || d === 'scaffold_independence'));
        const durableMissing = [...missing];
        if (delayed.status !== 'satisfied')
            durableMissing.push('delayed_independent_verification');
        for (const g of applicableGaps.filter(g => g.status === 'AWAITING_VERIFICATION'))
            durableMissing.push('gap_verification:' + g.id);
        if (ambiguity)
            durableMissing.push('ambiguous_required_evaluation');
        const stage = !profile ? 'not_applicable' : missing.length ? prerequisiteWarnings.length ? 'not_ready' : 'instructionally_ready' : durableMissing.length ? 'provisional_competence' : 'durable_mastery';
        results.set(conceptId, { conceptId, title: node.title, nodeType: node.type, stage, requiredDimensions: profile ?? [], delayed, gaps: applicableGaps.map(g => g.id), prerequisiteWarnings, missingProvisional: !profile ? [] : missing, missingDurable: !profile ? [] : durableMissing });
    }
    return [...results.values()];
}
