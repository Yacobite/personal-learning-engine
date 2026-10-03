import type { TaskInput } from '../domain/assessment.ts';
import type { CurriculumNode, SourceRef, ResearchRef } from '../domain/curriculum.ts';
export interface DiagnosticTaskContext {
    courseId: string;
    curriculumVersion: number;
    conceptId: string;
    type: TaskInput['type'];
    representation: TaskInput['representation'];
    novelty: TaskInput['novelty'];
    title: string;
    nodeType: CurriculumNode['type'];
    summary: string;
    prerequisites: {
        conceptId: string;
        title: string;
    }[];
    source: {
        ref: SourceRef;
        text: string;
        anchor: unknown;
        warnings: readonly string[];
    }[];
    research: {
        ref: ResearchRef;
        text: string;
        url: string;
    }[];
}
export interface DiagnosticTaskGenerator {
    propose(context: DiagnosticTaskContext): Promise<unknown>;
}
