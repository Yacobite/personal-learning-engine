import { canonical } from '../domain/assessment-validation.ts';
import { observations, dimensionStates } from '../domain/evidence-state-policy.ts';
import { gapKey, gapProjection } from '../domain/gap-policy.ts';
import { readinessProjection } from '../domain/readiness-policy.ts';
import { learnerPolicies, learnerId, LearnerStateError, timestamp } from '../domain/learner-state.ts';
import type { GapIdentity, LearnerStateRevision, Stage } from '../domain/learner-state.ts';
import type { LearnerLedger } from '../ports/learner-ledger.ts';
import type { LearnerStateRepository } from '../ports/learner-state-repository.ts';
import type { GraphService } from './graph-service.ts';
export class LearnerStateService {
    private readonly repo: LearnerStateRepository;
    private readonly ledger: LearnerLedger;
    private readonly graphs: Pick<GraphService, 'get'>;
    private readonly id: (prefix: 'state' | 'gap') => string;
    private readonly hash: (value: string) => string;
    private readonly clock: () => Date;
    constructor(repo: LearnerStateRepository, ledger: LearnerLedger, graphs: Pick<GraphService, 'get'>, id: (prefix: 'state' | 'gap') => string, hash: (value: string) => string, clock: () => Date) {
        this.repo = repo;
        this.ledger = ledger;
        this.graphs = graphs;
        this.id = id;
        this.hash = hash;
        this.clock = clock;
    }
    private identity(prefix: 'state' | 'gap') { const id = this.id(prefix); if (!learnerId(id, prefix))
        throw new LearnerStateError('Invalid generated learner-state identity.'); return id; }
    refresh(courseId: string, version?: number): LearnerStateRevision {
        const graph = this.graphs.get(courseId, version);
        const asOf = this.clock().toISOString();
        timestamp(asOf);
        return this.repo.refresh(courseId, graph.version, (identities, number) => {
            const currentConcepts = new Set(graph.nodes.map(n => n.conceptId));
            const records = this.ledger.read(courseId, asOf).filter(r => r.task.conceptIds.some(id => currentConcepts.has(id)));
            const observed = observations(records, asOf, this.hash);
            const fingerprint = this.hash(canonical({ policies: learnerPolicies, courseId, version: graph.version, nodes: graph.nodes.map(n => ({ id: n.conceptId, type: n.type })).sort((a, b) => a.id.localeCompare(b.id)), prerequisites: graph.edges.filter(e => e.type === 'prerequisite_of').map(e => [e.from, e.to]).sort(), observations: observed }));
            if (!/^[a-f0-9]{64}$/.test(fingerprint))
                throw new LearnerStateError('Hasher must return SHA-256.');
            const registry = new Map(identities.map(g => [[g.conceptId, g.dimension, g.triggerAttemptId, g.policy].join(':'), g]));
            const identity = (conceptId: string, dimension: GapIdentity['dimension'], triggerAttemptId: string, parent: string | null): GapIdentity => {
                const key = gapKey(conceptId, dimension, triggerAttemptId);
                let gap = registry.get(key);
                if (!gap) {
                    gap = { id: this.identity('gap'), courseId, conceptId, dimension, triggerAttemptId, policy: learnerPolicies.gap };
                    registry.set(key, gap);
                }
                return gap;
            };
            const gaps = graph.nodes.flatMap(node => gapProjection(courseId, node.conceptId, observed.filter(o => o.conceptIds.length === 1 && o.conceptIds[0] === node.conceptId), identity));
            const states = graph.nodes.flatMap(node => dimensionStates(node.conceptId, observed.filter(o => o.conceptIds.includes(node.conceptId)), gaps.filter(g => g.conceptId === node.conceptId)));
            return { id: this.identity('state'), courseId, curriculumVersion: graph.version, number, policies: learnerPolicies, createdAt: asOf, asOf, fingerprint, observations: observed, dimensions: states, gaps, readiness: readinessProjection(graph, states, gaps, observed) };
        });
    }
    revision(courseId: string, id: string) { if (!learnerId(id, 'state'))
        throw new LearnerStateError('Invalid state revision ID.'); const r = this.repo.get(courseId, id); if (!r)
        throw new LearnerStateError('State revision not found in this course.'); return r; }
    current(courseId: string, version?: number) { const graph = this.graphs.get(courseId, version); return this.repo.current(courseId, graph.version); }
    history(courseId: string) { this.graphs.get(courseId); return this.repo.history(courseId); }
    /** Read-only replay under the selected revision's terminal evaluations/profile.
     * This is an evidence-time timeline, not a history of old grading beliefs.
     * It reuses the M7 policies verbatim and publishes no revisions/gap identities.
     */
    competenceTimeline(courseId: string, conceptId: string, revisionId: string): { at: string; attemptId: string; stage: Stage }[] {
        const revision = this.revision(courseId, revisionId);
        const graph = this.graphs.get(courseId, revision.curriculumVersion);
        if (!graph.nodes.some(n => n.conceptId === conceptId)) throw new LearnerStateError('Concept absent from this curriculum.');
        const observed = revision.observations;
        const registry = new Map(revision.gaps.map(g => [gapKey(g.conceptId, g.dimension, g.triggerAttemptId), g]));
        const result: { at: string; attemptId: string; stage: Stage }[] = [];
        for (const [index, event] of observed.entries()) {
            if (!event.conceptIds.includes(conceptId)) continue;
            const prefix = observed.slice(0, index + 1);
            const gaps = graph.nodes.flatMap(node => gapProjection(courseId, node.conceptId, prefix.filter(o => o.conceptIds.length === 1 && o.conceptIds[0] === node.conceptId), (id, dimension, trigger) => {
                const key = gapKey(id, dimension, trigger);
                const identity = registry.get(key);
                if (!identity) throw new LearnerStateError('Revision is missing a projected gap identity.');
                return identity;
            }));
            const states = graph.nodes.flatMap(node => dimensionStates(node.conceptId, prefix.filter(o => o.conceptIds.includes(node.conceptId)), gaps.filter(g => g.conceptId === node.conceptId)));
            const stage = readinessProjection(graph, states, gaps, prefix).find(r => r.conceptId === conceptId)!.stage;
            if (stage !== result.at(-1)?.stage) result.push({ at: event.at, attemptId: event.attemptId, stage });
        }
        return result;
    }
    conceptState(courseId: string, conceptId: string, version?: number) { const revision = this.refresh(courseId, version); const report = revision.readiness.find(r => r.conceptId === conceptId); if (!report)
        throw new LearnerStateError('Concept absent from this curriculum.'); return { revisionId: revision.id, curriculumVersion: revision.curriculumVersion, asOf: revision.asOf, report, dimensions: revision.dimensions.filter(d => d.conceptId === conceptId), gaps: revision.gaps.filter(g => g.conceptId === conceptId) }; }
}
