import type { Concept, CurriculumVersion } from '../domain/curriculum.ts';
export interface GraphRepository {
    concept(courseId: string, id: string): Concept | undefined;
    saveDraft(input: Omit<CurriculumVersion, 'version' | 'activatedAt'>, newConcepts: readonly Concept[]): CurriculumVersion;
    get(courseId: string, version: number): CurriculumVersion | undefined;
    list(courseId: string): CurriculumVersion[];
    current(courseId: string): number | undefined;
    activate(courseId: string, version: number, at: string): void;
}
