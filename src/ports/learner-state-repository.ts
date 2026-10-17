import type { GapIdentity, LearnerStateRevision } from '../domain/learner-state.ts';
export interface LearnerStateRepository {
    /** Synchronous build runs within the refresh transaction; no network/model work. */
    refresh(courseId: string, version: number, build: (identities: readonly GapIdentity[], number: number) => LearnerStateRevision): LearnerStateRevision;
    current(courseId: string, version: number): LearnerStateRevision | undefined;
    get(courseId: string, id: string): LearnerStateRevision | undefined;
    history(courseId: string): LearnerStateRevision[];
}
