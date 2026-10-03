export interface ResearchReference {
    readonly id: string;
    readonly url: string;
    readonly title: string | null;
    readonly publisher: 'Python Software Foundation';
    readonly retrievedAt: string;
    readonly contentHash: string | null;
    readonly authority: 'official_documentation';
    readonly status: 'ready' | 'failed';
    readonly text: string;
    readonly topics: readonly string[];
    readonly notes: readonly string[];
}
export interface ResearchBrief {
    readonly id: string;
    readonly courseId: string;
    readonly goal: string;
    readonly createdAt: string;
    readonly references: readonly ResearchReference[];
}
