import type { Course } from './course.ts';
import type { CurriculumVersion, SourceRef, ResearchRef } from './curriculum.ts';
import type { SourceVersion, SourceKind } from './source.ts';
import type { ResearchReference } from './research.ts';
import type { LearnerStateRevision } from './learner-state.ts';
import type { DiagnosticSession, DiagnosticProbe } from './diagnostic.ts';
import type { TeachingSession, TeachingMove } from './teaching.ts';
import type { ReviewItem } from './review.ts';
export class ObsidianError extends Error {
    constructor(message: string) { super(message); this.name = 'ObsidianError'; }
}
export const obsidianFormat = 'obsidian-workspace-v1';
export const studyPolicy = 'grounded-study-v1';
export interface ObsidianSnapshot {
    course: Course;
    graph: CurriculumVersion;
    versions: CurriculumVersion[];
    state: LearnerStateRevision | null;
    history: LearnerStateRevision[];
    reviews: ReviewItem[];
    at: string;
    performance: Record<string, {
        assistance: string;
        hintCount: number;
        outcome: string;
    }>;
    sources: (Omit<SourceVersion, 'segments'> & {
        kind: SourceKind;
    })[];
    research: (Omit<ResearchReference, 'text'> & {
        briefId: string;
    })[];
    diagnostics: {
        session: DiagnosticSession;
        probes: DiagnosticProbe[];
    }[];
    teaching: {
        session: Omit<TeachingSession, 'state'>;
        moves: Omit<TeachingMove, 'content'>[];
    }[];
}
export interface StudyMaterial {
    coreIdea?: string;
    intuition?: string;
    formalStatement?: string;
    keyPoints?: string[];
    example?: string;
    nonExample?: string;
    commonConfusion?: string;
    prerequisiteConnection?: string;
    selfCheckPrompts?: string[];
    sourceRefs: SourceRef[];
    researchRefs: ResearchRef[];
}
