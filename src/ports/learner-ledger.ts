import type { PerformanceRecord } from '../domain/learner-state.ts';
export interface LearnerLedger {
    read(courseId: string, asOf: string): PerformanceRecord[];
}
