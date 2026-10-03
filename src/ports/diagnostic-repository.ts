import type { DiagnosticProbe, DiagnosticSession, DiagnosticSummary } from '../domain/diagnostic.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
export interface DiagnosticRepository {
    start(session: DiagnosticSession): DiagnosticSession;
    current(courseId: string): DiagnosticSession | undefined;
    get(courseId: string, id: string): DiagnosticSession | undefined;
    history(courseId: string): DiagnosticSession[];
    probes(courseId: string, sessionId: string): DiagnosticProbe[];
    insertProbe(probe: DiagnosticProbe): void;
    attachAttempt(courseId: string, probeId: string, attemptId: string, at: string): void;
    attachOutcome(courseId: string, probeId: string, outcome: EvaluationWrite, at: string): void;
    skip(courseId: string, probeId: string, at: string): void;
    finish(courseId: string, sessionId: string, status: 'completed' | 'abandoned', summary: DiagnosticSummary): DiagnosticSession;
}
