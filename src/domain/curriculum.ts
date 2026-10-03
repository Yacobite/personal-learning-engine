import type { SourceAnchor } from './source.ts';
export const nodeTypes = ['concept', 'definition', 'procedure', 'representation', 'misconception', 'boundary_case', 'assessment_objective'] as const;
export const edgeTypes = ['prerequisite_of', 'confusable_with', 'related_to', 'represented_by', 'counterexample_to', 'contrasts_with', 'used_by', 'transfers_to', 'assessed_by'] as const;
export type NodeType = typeof nodeTypes[number];
export type EdgeType = typeof edgeTypes[number];
export interface Concept {
    readonly id: string;
    readonly courseId: string;
    readonly createdAt: string;
}
export interface SourceRef {
    readonly sourceId: string;
    readonly version: number;
    readonly segmentId: string;
}
export interface ResearchRef {
    readonly briefId: string;
    readonly referenceId: string;
}
export interface ProposalNode {
    readonly key: string;
    readonly conceptId?: string;
    readonly title: string;
    readonly type: NodeType;
    readonly summary: string;
    readonly sourceRefs: readonly SourceRef[];
    readonly researchRefs: readonly ResearchRef[];
}
export interface ProposalEdge {
    readonly from: string;
    readonly to: string;
    readonly type: EdgeType;
    readonly rationale: string;
}
export interface CurriculumProposal {
    readonly nodes: readonly ProposalNode[];
    readonly edges: readonly ProposalEdge[];
    readonly rationale: string;
    readonly uncertainty: readonly string[];
}
export interface CurriculumNode extends Omit<ProposalNode, 'key' | 'conceptId' | 'sourceRefs'> {
    readonly conceptId: string;
    readonly sourceRefs: readonly (SourceRef & {
        readonly anchor: SourceAnchor;
    })[];
}
export interface CurriculumVersion {
    readonly courseId: string;
    readonly version: number;
    readonly createdAt: string;
    readonly activatedAt: string | null;
    readonly nodes: readonly CurriculumNode[];
    readonly edges: readonly ProposalEdge[];
    readonly rationale: string;
    readonly uncertainty: readonly string[];
}
export class GraphError extends Error {
    constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'GraphError'; }
}
export const isConceptId = (id: string): boolean => /^concept-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function requireVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new GraphError('Expected a positive curriculum version.');
}
/** All relations are directed. Only prerequisite_of imposes ordering. */
export function prerequisiteOrder(ids: readonly string[], edges: readonly ProposalEdge[]): string[] {
    const incoming = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
    for (const edge of edges) {
        if (!incoming.has(edge.from) || !incoming.has(edge.to))
            throw new GraphError('Edge endpoint does not exist.');
        if (edge.type !== 'prerequisite_of')
            continue;
        if (edge.from === edge.to)
            throw new GraphError('Prerequisite self-loop.');
        incoming.set(edge.to, incoming.get(edge.to)! + 1);
        outgoing.get(edge.from)!.push(edge.to);
    }
    const ready = ids.filter((id) => incoming.get(id) === 0).sort();
    const ordered: string[] = [];
    while (ready.length) {
        const id = ready.shift()!;
        ordered.push(id);
        for (const next of outgoing.get(id)!.sort()) {
            incoming.set(next, incoming.get(next)! - 1);
            if (incoming.get(next) === 0) {
                ready.push(next);
                ready.sort();
            }
        }
    }
    if (ordered.length !== ids.length)
        throw new GraphError('Prerequisite cycle detected.');
    return ordered;
}
