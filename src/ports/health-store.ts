import type { DatabaseHealth } from '../domain/health.ts';
export interface HealthStore {
    /** Explicit read-only full integrity/FK scan; never repairs or reconciles learning state. */
    diagnose(courseId?: string): DatabaseHealth;
}
