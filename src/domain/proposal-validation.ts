import { edgeTypes, GraphError, isConceptId, nodeTypes, prerequisiteOrder } from './curriculum.ts';
import type { CurriculumProposal } from './curriculum.ts';
import { isSourceId } from './source.ts';
export const isResearchId = (id: string, prefix: 'brief' | 'reference'): boolean => new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(id);
function fail(): never { throw new GraphError('Invalid curriculum proposal shape, bounds, or references.'); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail();
    const result = value as Record<string, unknown>;
    if (required.some((key) => !Object.hasOwn(result, key)) || Object.keys(result).some((key) => ![...required, ...optional].includes(key)))
        fail();
    return result;
}
function text(value: unknown, max: number): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail();
}
function array(value: unknown, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max)
        fail();
    return value as unknown[];
}
export function validateProposal(value: unknown): CurriculumProposal {
    const proposal = object(value, ['nodes', 'edges', 'rationale', 'uncertainty']);
    text(proposal.rationale, 4000);
    array(proposal.uncertainty, 50).forEach((note) => text(note, 2000));
    const nodes = array(proposal.nodes, 500);
    if (!nodes.length)
        fail();
    const keys = new Set<string>();
    const reused = new Set<string>();
    for (const item of nodes) {
        const node = object(item, ['key', 'title', 'type', 'summary', 'sourceRefs', 'researchRefs'], ['conceptId']);
        text(node.key, 80);
        if (!/^[a-zA-Z0-9_-]+$/.test(node.key) || keys.has(node.key))
            fail();
        keys.add(node.key);
        text(node.title, 200);
        text(node.summary, 2000);
        if (!nodeTypes.includes(node.type as never))
            fail();
        if (node.conceptId !== undefined) {
            text(node.conceptId, 44);
            if (!isConceptId(node.conceptId) || reused.has(node.conceptId))
                fail();
            reused.add(node.conceptId);
        }
        const refs = array(node.sourceRefs, 20);
        const research = array(node.researchRefs, 20);
        if (!refs.length && !research.length)
            throw new GraphError('Every node requires source or research provenance.');
        const unique = new Set<string>();
        for (const value of refs) {
            const ref = object(value, ['sourceId', 'version', 'segmentId']);
            text(ref.sourceId, 43);
            text(ref.segmentId, 100);
            if (!isSourceId(ref.sourceId) || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1
                || !new RegExp(`^${ref.sourceId}@${ref.version}:\\d+$`).test(ref.segmentId))
                fail();
            if (unique.has(ref.segmentId))
                fail();
            unique.add(ref.segmentId);
        }
        for (const value of research) {
            const ref = object(value, ['briefId', 'referenceId']);
            text(ref.briefId, 42);
            text(ref.referenceId, 46);
            if (!isResearchId(ref.briefId, 'brief') || !isResearchId(ref.referenceId, 'reference'))
                fail();
            if (unique.has(ref.referenceId))
                fail();
            unique.add(ref.referenceId);
        }
    }
    const edges = array(proposal.edges, 2000);
    const uniqueEdges = new Set<string>();
    for (const item of edges) {
        const edge = object(item, ['from', 'to', 'type', 'rationale']);
        text(edge.from, 80);
        text(edge.to, 80);
        text(edge.rationale, 2000);
        if (!keys.has(edge.from) || !keys.has(edge.to) || !edgeTypes.includes(edge.type as never))
            fail();
        // Reflexive relationships add no useful M3 information, regardless of type.
        if (edge.from === edge.to)
            throw new GraphError('Self-relations are not supported.');
        const key = `${edge.from}:${edge.type}:${edge.to}`;
        if (uniqueEdges.has(key))
            fail();
        uniqueEdges.add(key);
    }
    const result = value as CurriculumProposal;
    prerequisiteOrder([...keys], result.edges);
    // Detach untrusted mutable arguments before passing them to persistence.
    return JSON.parse(JSON.stringify(result)) as CurriculumProposal;
}
