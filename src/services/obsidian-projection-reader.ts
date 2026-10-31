import { ObsidianError } from '../domain/obsidian.ts';
import type { ObsidianSnapshot } from '../domain/obsidian.ts';
import type { ObsidianProjectionReader } from '../ports/obsidian.ts';
import type { CourseRepository } from '../ports/course-repository.ts';
import type { GraphRepository } from '../ports/graph-repository.ts';
import type { SourceRepository } from '../ports/source-repository.ts';
import type { ResearchRepository } from '../ports/research.ts';
import type { LearnerStateRepository } from '../ports/learner-state-repository.ts';
import type { DiagnosticRepository } from '../ports/diagnostic-repository.ts';
import type { TeachingRepository } from '../ports/teaching-repository.ts';
import type { LearnerLedger } from '../ports/learner-ledger.ts';
import type { ReviewRepository } from '../ports/review-repository.ts';
import type { TeachingContextBuilder } from './teaching-context.ts';
export interface ProjectionStores {
    learnerLedger: Pick<LearnerLedger, 'read'>;
    courses: Pick<CourseRepository, 'getById'>;
    graphs: Pick<GraphRepository, 'current' | 'get' | 'list'>;
    sources: Pick<SourceRepository, 'getVersion' | 'list'>;
    research: Pick<ResearchRepository, 'list'>;
    learnerState: Pick<LearnerStateRepository, 'current' | 'history'>;
    diagnostics: Pick<DiagnosticRepository, 'history' | 'probes'>;
    teaching: Pick<TeachingRepository, 'history' | 'moves'>;
    reviews: Pick<ReviewRepository, 'list'>;
}
/** Only read capabilities are accepted. In particular no state.refresh, review.queue, or M4 writers. */
export class CanonicalObsidianReader implements ObsidianProjectionReader {
    private readonly stores: ProjectionStores;
    private readonly grounding: Pick<TeachingContextBuilder, 'build'>;
    private readonly snapshot: <T>(read: () => T) => T;
    private readonly clock: () => Date;
    constructor(stores: ProjectionStores, grounding: Pick<TeachingContextBuilder, 'build'>, snapshot: <T>(read: () => T) => T, clock: () => Date) { this.stores = stores; this.grounding = grounding; this.snapshot = snapshot; this.clock = clock; }
    read(courseId: string): ObsidianSnapshot {
        return this.snapshot(() => {
            const s = this.stores, course = s.courses.getById(courseId);
            if (!course)
                throw new ObsidianError('Course not found.');
            const version = s.graphs.current(courseId), graph = version === undefined ? undefined : s.graphs.get(courseId, version);
            if (!graph)
                throw new ObsidianError('Activate a curriculum before Obsidian sync.');
            const sourceList = s.sources.list(courseId);
            const versions = s.graphs.list(courseId).filter(g => g.activatedAt !== null), refs = new Map<string, {
                sourceId: string;
                version: number;
            }>();
            for (const g of versions)
                for (const n of g.nodes)
                    for (const r of n.sourceRefs)
                        refs.set(r.sourceId + '@' + r.version, r);
            for (const source of sourceList)
                refs.set(source.id + '@' + source.currentVersion, { sourceId: source.id, version: source.currentVersion });
            const sources = [...refs.values()].map(r => s.sources.getVersion(courseId, r.sourceId, r.version)).filter(r => r !== undefined).map(({ segments: _segments, ...metadata }) => ({ ...metadata, kind: sourceList.find(v => v.id === metadata.sourceId)!.kind }));
            const at = this.clock().toISOString();
            const performance = Object.fromEntries(s.learnerLedger.read(courseId, at).map(r => { const superseded = new Set(r.evaluations.map(e => e.supersedes)), heads = r.evaluations.filter(e => !superseded.has(e.id)); return [r.attempt.id, { assistance: r.attempt.assistance, hintCount: r.attempt.hints.count, outcome: heads.length === 1 ? heads[0]!.status + ' / ' + String(heads[0]!.correctness) : heads.length ? 'ambiguous' : 'unevaluated' }]; }));
            return { course, graph, versions, performance, state: s.learnerState.current(courseId, version!) ?? null, history: s.learnerState.history(courseId), reviews: s.reviews.list(courseId), at, sources,
                research: s.research.list(courseId).flatMap(b => b.references.map(({ text: _text, ...ref }) => ({ ...ref, briefId: b.id }))),
                diagnostics: s.diagnostics.history(courseId).map(session => ({ session, probes: s.diagnostics.probes(courseId, session.id) })),
                teaching: s.teaching.history(courseId).map(({ state: _state, ...session }) => ({ session, moves: s.teaching.moves(courseId, session.id).map(({ content: _content, ...move }) => move) })) };
        });
    }
    ground(courseId: string, conceptId: string) { return this.snapshot(() => { const v = this.stores.graphs.current(courseId), g = v === undefined ? undefined : this.stores.graphs.get(courseId, v); if (!g)
        throw new ObsidianError('Activate a curriculum first.'); return this.grounding.build(g, conceptId, 1); }); }
}
