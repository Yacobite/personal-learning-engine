import { learnerId, LearnerStateError } from '../domain/learner-state.ts';
import type { LearnerStateService } from './learner-state-service.ts';
export class GapService {
    private readonly state: LearnerStateService;
    constructor(state: LearnerStateService) { this.state = state; }
    current(courseId: string) { return this.state.refresh(courseId).gaps.filter(g => g.status !== 'VERIFIED_CLOSED'); }
    list(courseId: string) { const current = this.state.refresh(courseId); const revisions = this.state.history(courseId); const ids = new Set(revisions.flatMap(r => r.gaps.map(g => g.id))); return [...ids].map(id => ({ id, current: current.gaps.find(g => g.id === id) ?? null, revisionIds: revisions.filter(r => r.gaps.some(g => g.id === id)).map(r => r.id) })); }
    show(courseId: string, id: string) { if (!learnerId(id, 'gap'))
        throw new LearnerStateError('Invalid gap ID.'); const current = this.state.refresh(courseId); const history = this.state.history(courseId).flatMap(r => r.gaps.filter(g => g.id === id).map(g => ({ revisionId: r.id, curriculumVersion: r.curriculumVersion, asOf: r.asOf, snapshot: g }))); if (!history.length)
        throw new LearnerStateError('Gap not found in this course.'); return { current: current.gaps.find(g => g.id === id) ?? null, history }; }
}
