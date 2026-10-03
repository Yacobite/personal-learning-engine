import type { CurriculumVersion } from './curriculum.ts';
import { episode, TeachingError } from './teaching.ts';
import type { TeachingState, TeachingMove, TeachingObservation, EpisodeOutcome, Scaffold } from './teaching.ts';
export interface TeachingDecision {
    state: TeachingState;
    reason: string;
}
/** Deterministic workflow only: never creates knowledge classifications or evidence. */
export function advance(graph: CurriculumVersion, previous: TeachingState, move: TeachingMove, observation?: TeachingObservation): TeachingDecision {
    const state = structuredClone(previous);
    const e = state.episode;
    if (!e || e.conceptId !== move.conceptId)
        throw new TeachingError('Teaching state does not match the move.');
    const finish = (outcome: EpisodeOutcome): TeachingDecision => {
        state.outcomes.push({ conceptId: e.conceptId, outcome });
        const parent = state.stack.pop();
        if (parent) {
            parent.phase = 'scaffold';
            state.episode = parent;
            return { state, reason: 'return_to_original_concept' };
        }
        const next = state.queue.shift();
        state.episode = next ? episode(next) : null;
        return { state, reason: next ? 'next_recommended_target' : 'episode_finished' };
    };
    if (move.type === 'explain') {
        e.phase = e.level ? 'guided_practice' : 'independent_practice';
        return { state, reason: 'retrieve_after_explanation' };
    }
    if (move.type === 'scaffold') {
        e.phase = 'guided_practice';
        return { state, reason: 'apply_with_recorded_support' };
    }
    if (!observation)
        throw new TeachingError('Interactive move requires a stored observation.');
    const head = observation.heads[0];
    if (observation.heads.length !== 1 || !head || head.status === 'failed')
        throw new TeachingError('Resolve evaluation failure or conflicting heads before continuing.');
    if (move.type === 'teach_back') {
        e.phase = 'near_transfer';
        e.level = 0;
        e.transfers++;
        return { state, reason: 'independent_changed_context_check' };
    }
    const success = head.status === 'scored' && head.correctness === 1;
    const independent = observation.attempt.assistance === 'none' && observation.attempt.hints.count === 0;
    if (success) {
        if (move.type === 'activate_prior_knowledge' && independent) {
            e.phase = 'explain';
            return { state, reason: 'focused_grounded_explanation' };
        }
        if (move.type === 'near_transfer' && independent)
            return finish(e.supported ? 'completed_with_support' : 'completed_independently');
        if (!independent)
            e.supported = true;
        e.phase = 'teach_back';
        return { state, reason: independent ? 'independent_success_explain_back' : 'assisted_success_requires_independent_check' };
    }
    e.failures++;
    e.supported = true;
    if (move.type === 'near_transfer' && e.transfers >= 2)
        return finish('needs_more_instruction');
    if (e.failures >= 2 && !e.detoured && state.stack.length < 4) {
        const visited = new Set([e.conceptId, ...state.stack.map(f => f.conceptId)]);
        const parent = graph.edges.filter(edge => edge.type === 'prerequisite_of' && edge.to === e.conceptId && !visited.has(edge.from)).map(edge => edge.from).sort()[0];
        if (parent) {
            e.detoured = true;
            e.level = Math.max(e.level, 2) as Scaffold;
            state.stack.push(e);
            state.episode = episode(parent);
            return { state, reason: 'prerequisite_backtrack' };
        }
    }
    if (e.level === 4) {
        e.phase = 'teach_back';
        return { state, reason: 'worked_support_requires_fresh_check' };
    }
    e.level = (Math.max(e.level, move.level) + 1) as Scaffold;
    e.phase = 'scaffold';
    return { state, reason: head.status === 'unscored' ? 'uncertain_check_needs_support' : 'difficulty_minimum_next_support' };
}
