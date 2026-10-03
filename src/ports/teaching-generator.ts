import type { DiagnosticTaskContext } from './diagnostic-generator.ts';
import type { MoveType, Scaffold } from '../domain/teaching.ts';
export interface TeachingContext {
    grounding: DiagnosticTaskContext;
    moveType: MoveType;
    level: Scaffold;
    reason: string;
    previousPrompts: string[];
    pendingTask: unknown | null;
    feedback?: {
        response: string;
        result: string;
    } | null;
    workedAnswer?: unknown;
}
export interface TeachingContentGenerator {
    propose(context: TeachingContext): Promise<unknown>;
}
