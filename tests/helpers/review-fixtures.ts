import { learnerFixture } from './learner-state-fixtures.ts';
import { ids, hash } from './assessment-fixtures.ts';
import { ReviewService } from '../../src/services/review-service.ts';
import { TeachingContextBuilder } from '../../src/services/teaching-context.ts';
import type { ReviewTaskContext, ReviewTaskGenerator } from '../../src/ports/review-generator.ts';
import { competenceProfile } from '../../src/domain/competence-profile.ts';
export const day = 86400000;
export function reviewFixture(path = ':memory:') {
    const f = learnerFixture(path);
    const context = new TeachingContextBuilder(f.store.sources, f.store.research);
    const reviews = new ReviewService(f.store.reviews, f.store.assessments, f.graphs, f.assessments, f.evaluations, f.state, context, () => ids('review'), hash, f.clock);
    let sequence = 0;
    const generator: ReviewTaskGenerator = { propose: async (c) => proposal(c, ++sequence) };
    function support(conceptId = f.root) {
        const node = f.graphs.get(f.courseId).nodes.find(n => n.conceptId === conceptId)!;
        for (const dimension of competenceProfile(node.type)!)
            f.add({ conceptId, dimensions: [dimension], novelty: dimension === 'transfer' ? 'near_transfer' : 'isomorphic' });
        return reviews.refresh(f.courseId);
    }
    function durable(conceptId = f.root) { support(conceptId); f.tick(day); f.add({ conceptId }); return reviews.refresh(f.courseId); }
    return { ...f, reviews, generator, context, support, durable };
}
export function proposal(c: ReviewTaskContext, sequence = 1) {
    return { prompt: 'SYNTHETIC REVIEW FIXTURE ' + sequence + ': select the option denoting the displayed development number ' + sequence + '. This validates orchestration, not course knowledge.',
        scoring: { kind: 'choice', options: ['alpha', 'beta'], expected: 'alpha' }, sourceRefs: c.grounding.source.map(s => s.ref), researchRefs: c.grounding.research.map(r => r.ref) };
}
