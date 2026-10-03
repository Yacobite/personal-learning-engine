import { prerequisiteOrder } from './curriculum.ts';
import type { CurriculumVersion } from './curriculum.ts';
import type { DiagnosticProbe, Finding, Observation, StopReason } from './diagnostic.ts';
/** Graph closure affects navigation only. It never creates performance observations. */
export function topology(graph: CurriculumVersion) {
    const ids = graph.nodes.map(n => n.conceptId).sort();
    const parents = new Map(ids.map(id => [id, [] as string[]]));
    const children = new Map(ids.map(id => [id, [] as string[]]));
    for (const e of graph.edges.filter(e => e.type === 'prerequisite_of')) {
        parents.get(e.to)!.push(e.from);
        children.get(e.from)!.push(e.to);
    }
    const depth = new Map<string, number>();
    for (const id of prerequisiteOrder(ids, graph.edges))
        depth.set(id, Math.max(0, ...parents.get(id)!.map(p => depth.get(p)! + 1)));
    const closure = (id: string, edges: Map<string, string[]>): string[] => {
        const found = new Set<string>();
        const queue = [...edges.get(id)!];
        for (let i = 0; i < queue.length; i++) {
            const next = queue[i]!;
            if (!found.has(next)) {
                found.add(next);
                queue.push(...edges.get(next)!);
            }
        }
        return [...found].sort();
    };
    const regions = new Map<string, string>();
    for (const id of ids)
        if (!regions.has(id)) {
            const queue = [id];
            regions.set(id, id);
            for (let i = 0; i < queue.length; i++)
                for (const n of [...parents.get(queue[i]!)!, ...children.get(queue[i]!)!]) {
                    if (!regions.has(n)) {
                        regions.set(n, id);
                        queue.push(n);
                    }
                }
        }
    return { ids, parents, children, depth, closure, regions };
}
export function frontier(graph: CurriculumVersion, values: readonly Finding[]) {
    const t = topology(graph);
    const states = new Map(values.map(f => [f.conceptId, f.state]));
    return t.ids.filter(id => states.get(id) !== 'provisionally_supported'
        && t.parents.get(id)!.every(p => states.get(p) === 'provisionally_supported'))
        .map(conceptId => ({ conceptId, reason: states.get(conceptId) === 'provisionally_unsupported' ? 'direct_difficulty' as const
            : states.get(conceptId) === 'not_probed' ? 'untested_prerequisite' as const : 'uncertain' as const }));
}
export function selection(graph: CurriculumVersion, values: readonly Finding[], probes: readonly DiagnosticProbe[], prior: readonly Observation[], budget: number, probeable?: ReadonlySet<string>): {
    stop: StopReason;
} | {
    conceptId: string;
    reason: string;
} {
    const t = topology(graph);
    const states = new Map(values.map(f => [f.conceptId, f.state]));
    if (t.ids.every(id => states.get(id) === 'provisionally_supported'))
        return { stop: 'coverage_sufficient' };
    const boundaries = frontier(graph, values).filter(f => f.reason === 'direct_difficulty').map(f => f.conceptId);
    const bounded = new Set(boundaries.flatMap(id => [id, ...t.closure(id, t.children)]));
    if (boundaries.length && t.ids.every(id => states.get(id) === 'provisionally_supported' || bounded.has(id)))
        return { stop: 'frontier_located' };
    if (probes.length >= budget)
        return { stop: 'budget_exhausted' };
    const asked = new Set(probes.map(p => p.conceptId));
    const eligible = t.ids.filter(id => !asked.has(id) && !bounded.has(id) && (!probeable || probeable.has(id)));
    if (!eligible.length)
        return { stop: 'no_eligible_probe' };
    const last = probes.filter(p => p.status === 'resolved').at(-1);
    if (last) {
        const supported = states.get(last.conceptId) === 'provisionally_supported';
        const preferred = t.closure(last.conceptId, supported ? t.children : t.parents).filter(id => eligible.includes(id));
        preferred.sort((a, b) => supported ? t.depth.get(a)! - t.depth.get(b)! || a.localeCompare(b) : t.depth.get(b)! - t.depth.get(a)! || a.localeCompare(b));
        if (preferred[0])
            return { conceptId: preferred[0], reason: supported ? 'check_dependent_after_direct_support' : 'check_prerequisite_after_difficulty_or_uncertainty' };
    }
    const priorPriority = new Set(prior.flatMap(o => o.conceptIds.flatMap(id => t.parents.has(id)
        ? o.state === 'provisionally_supported' ? t.children.get(id)! : o.state === 'provisionally_unsupported' ? t.parents.get(id)! : [] : [])));
    const regionCount = (id: string) => probes.filter(p => t.regions.get(p.conceptId) === t.regions.get(id)).length;
    const midpoint = (id: string) => Math.floor(Math.max(...t.ids.filter(n => t.regions.get(n) === t.regions.get(id)).map(n => t.depth.get(n)!)) / 2);
    eligible.sort((a, b) => regionCount(a) - regionCount(b) || Number(priorPriority.has(b)) - Number(priorPriority.has(a))
        || Math.abs(t.depth.get(a)! - midpoint(a)) - Math.abs(t.depth.get(b)! - midpoint(b))
        || t.children.get(b)!.length - t.children.get(a)!.length || a.localeCompare(b));
    return { conceptId: eligible[0]!, reason: priorPriority.has(eligible[0]!) ? 'prior_evidence_priority_only' : 'middle_depth_and_branch_coverage' };
}
