import { canonical } from './assessment-validation.ts';
import { taskConstraints } from './review-task-policy.ts';
import { reviewOutcome, reviewPolicies, ReviewError } from './review.ts';
import type { ReviewItem, ReviewCandidate } from './review.ts';
import type { LearnerStateRevision, ReadinessResult, Stage } from './learner-state.ts';
const day = 86400000;
export function maintenanceDays(stage: number): number {
    if (!Number.isSafeInteger(stage) || stage < 0)
        throw new ReviewError('Invalid spacing stage.');
    return [3, 7, 14, 30, 60][Math.min(stage, 4)]!;
}
const plus = (at: string, days: number) => new Date(Date.parse(at) + day * days).toISOString();
const signature = (r: ReadinessResult) => canonical([r.nodeType, [...r.requiredDimensions].sort()]);
/** Interpret M7 stage history only; no evidence-to-mastery rules are reproduced here. */
export type CompetenceTimeline = readonly {
    at: string;
    attemptId: string;
    stage: Stage;
}[];
function durableEpisode(report: ReadinessResult, timeline: CompetenceTimeline) {
    const event = timeline.at(-1);
    if (!event || event.stage !== 'durable_mastery')
        throw new ReviewError('Durable M7 report lacks its qualifying transition.');
    return { at: event.at, key: canonical([report.conceptId, signature(report), event.attemptId]) };
}
export function reviewCandidates(state: LearnerStateRevision, history: readonly ReviewItem[], timelines: Readonly<Record<string, CompetenceTimeline>>, hash: (s: string) => string): ReviewCandidate[] {
    const result: ReviewCandidate[] = [];
    for (const report of state.readiness) {
        const relevant = history.filter(i => i.conceptId === report.conceptId);
        const requests: {
            kind: ReviewCandidate['kind'];
            at: string;
            gapId: string | null;
            stage: number;
            episode: string;
            dimension?: ReviewCandidate['dimension'];
        }[] = [];
        if (report.stage === 'provisional_competence' && report.delayed.status === 'waiting_for_delayed_evidence' && report.delayed.eligibleAfter)
            requests.push({ kind: 'delayed_verification', at: report.delayed.eligibleAfter, gapId: null, stage: 0, episode: 'delayed:' + report.delayed.baselineAttemptId });
        for (const g of state.gaps.filter(g => g.conceptId === report.conceptId && g.status === 'AWAITING_VERIFICATION' && g.eligibleAfter))
            requests.push({ kind: 'gap_verification', at: g.eligibleAfter!, gapId: g.id, stage: 0, episode: 'gap:' + g.id + ':' + g.awaitingAttemptId, dimension: g.dimension });
        if (report.stage === 'durable_mastery') {
            const episode = durableEpisode(report, timelines[report.conceptId] ?? []);
            let at = episode.at, stage = 0;
            const completed = relevant.filter(i => i.kind === 'maintenance' && i.status === 'completed' && i.episode === episode.key).sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id));
            for (const i of completed) {
                const o = state.observations.find(o => o.attemptId === i.attemptId);
                if (!o)
                    continue;
                if (reviewOutcome(i, o) === 'qualifying_success') {
                    stage = Math.min(stage + 1, 4);
                    at = o.at;
                }
            }
            requests.push({ kind: 'maintenance', at: plus(at, maintenanceDays(stage)), gapId: null, stage, episode: episode.key });
        }
        for (const request of requests) {
            let at = request.at;
            const completed = relevant.filter(i => i.status === 'completed' && i.kind === request.kind && i.episode === request.episode).sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id));
            const last = completed.at(-1);
            if (last) {
                const o = state.observations.find(o => o.attemptId === last.attemptId);
                if (o && reviewOutcome(last, o) !== 'qualifying_success')
                    at = [at, plus(o.at, 1)].sort().at(-1)!;
            }
            // Keep a still-valid pending target despite unrelated observations/rotation.
            const pending = relevant.find(i => ['scheduled', 'active', 'awaiting_evaluation'].includes(i.status) && i.curriculumVersion === state.curriculumVersion && i.kind === request.kind && i.episode === request.episode && i.stage === request.stage && i.earliestAt === at);
            const constraints = pending ?? taskConstraints(state, report, request.kind, relevant, request.dimension);
            if (!constraints)
                continue;
            const { dimension, type, representation, novelty, assistance } = constraints;
            const semantic = { courseId: state.courseId, curriculumVersion: state.curriculumVersion, conceptId: report.conceptId, kind: request.kind, policies: reviewPolicies,
                dimension, type, representation, novelty, assistance, earliestAt: at, dueAt: at, stage: request.stage, gapId: request.gapId, episode: request.episode };
            result.push({ ...semantic, stateRevisionId: state.id, basis: hash(canonical(semantic)) });
        }
    }
    return result;
}
