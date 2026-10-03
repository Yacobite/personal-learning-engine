import type { ResearchBrief } from '../domain/research.ts';
export interface ResearchRepository {
    save(brief: ResearchBrief): void;
    get(courseId: string, id: string): ResearchBrief | undefined;
    list(courseId: string): ResearchBrief[];
}
export interface OfficialResearcher {
    retrieve(courseId: string, goal: string): Promise<ResearchBrief>;
}
