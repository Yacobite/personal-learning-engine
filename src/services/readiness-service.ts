import type { LearnerStateService } from './learner-state-service.ts';
export class ReadinessService {
    private readonly state: LearnerStateService;
    constructor(state: LearnerStateService) { this.state = state; }
    conceptReport(courseId: string, conceptId: string) { return this.state.conceptState(courseId, conceptId); }
    courseReport(courseId: string) {
        const r = this.state.refresh(courseId);
        const groups = Object.fromEntries(['durable_mastery', 'provisional_competence', 'instructionally_ready', 'not_ready', 'not_applicable'].map(stage => [stage, r.readiness.filter(c => c.stage === stage).map(c => ({ conceptId: c.conceptId, title: c.title, missingProvisional: c.missingProvisional, missingDurable: c.missingDurable, prerequisiteWarnings: c.prerequisiteWarnings }))]));
        return { revisionId: r.id, curriculumVersion: r.curriculumVersion, asOf: r.asOf, policies: r.policies, groups, openGaps: r.gaps.filter(g => g.status === 'OPEN' || g.status === 'REPAIR_IN_PROGRESS').map(g => g.id), awaitingVerification: r.gaps.filter(g => g.status === 'AWAITING_VERIFICATION').map(g => ({ id: g.id, eligibleAfter: g.eligibleAfter })), warning: 'Evidence-based estimates, not psychological certainty. Eligibility timestamps do not schedule reviews.' };
    }
}
