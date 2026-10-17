import { listWindow } from './command-surface.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CurriculumVersion } from '../../domain/curriculum.ts';
import { GraphError, prerequisiteOrder } from '../../domain/curriculum.ts';
import type { ResearchService } from '../../services/research-service.ts';
import { CourseError } from '../../domain/course.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { GraphService } from '../../services/graph-service.ts';
import type { CourseSession } from './course-session.ts';
import { parseArguments } from './command-arguments.ts';
import { formatAnchor } from './register-source.ts';
export function compactMap(graph: CurriculumVersion): string {
    const title = new Map(graph.nodes.map((node) => [node.conceptId, node.title]));
    const roots = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.type === 'prerequisite_of' && edge.to === node.conceptId));
    const order = prerequisiteOrder(graph.nodes.map((node) => node.conceptId), graph.edges);
    const orderedNodes = order.map((id) => graph.nodes.find((node) => node.conceptId === id)!);
    return `Curriculum v${graph.version}: ${graph.nodes.length} concepts, ${graph.edges.length} relationships\nRoots: ${roots.slice(0,30).map((node) => node.title).join(', ')}${roots.length>30?' (additional roots omitted)':''}\n`
        + orderedNodes.slice(0,40).map((node) => `${node.title} [${node.type}] — ${node.conceptId}`).join('\n')
        + (graph.nodes.length>40?'\nAdditional concepts omitted; inspect by ID or version.':'') + '\n'
        + graph.edges.slice(0, 60).map((edge) => `${title.get(edge.from)} → ${title.get(edge.to)} (${edge.type})`).join('\n')
        + (graph.edges.length > 60 ? '\nAdditional relationships omitted from compact display.' : '')
        + (graph.uncertainty.length ? '\nUncertainty/omissions: ' + graph.uncertainty.join('; ') : '');
}
export interface CurriculumRuntime {
    readonly courses: CourseService;
    readonly selection: CourseSession;
    readonly graphs: GraphService;
    readonly research: ResearchService;
    readonly build: (courseId: string, ctx: Pick<ExtensionContext, 'cwd' | 'model'>) => Promise<CurriculumVersion>;
}
const usage = 'Usage: /curriculum build | list | show [version] | validate [version] | activate <version> | concept <id> [version] | prerequisites <id> [version] | research [brief-id]';
export function registerCurriculum(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => CurriculumRuntime): void {
    pi.registerCommand('curriculum', { description: 'Build, inspect, validate and explicitly activate versioned curriculum', handler: async (args, ctx) => {
            try {
                const [command, ...params] = parseArguments(args);
                const { courses, selection, graphs, build, research } = runtime();
                const active = selection.current(courses);
                if (!active) {
                    ctx.ui.notify('No active course. Select one with /course use <id>.', 'error');
                    return;
                }
                if (command === 'build' && !params.length) {
                    const draft = await build(active.id, ctx);
                    ctx.ui.notify(`Draft v${draft.version} created. Inspect with /curriculum show ${draft.version}; activate explicitly when approved.\n${compactMap(draft)}`, 'info');
                }
                else if (command === 'list' && !params.length) {
                    const current = graphs.current(active.id);
                    const versions = graphs.list(active.id);
                    ctx.ui.notify(`Active curriculum: ${current === undefined ? 'none' : `v${current}`}\n` + (versions.length ? listWindow(versions).map((graph) => `v${graph.version}: ${current === graph.version ? 'active' : graph.activatedAt ? 'previously activated' : 'draft'}; ${graph.nodes.length} concepts`).join('\n') : 'No curriculum versions.'), 'info');
                }
                else if (command === 'research' && params.length <= 1) {
                    const briefs = params[0] ? [research.get(active.id,params[0])] : research.list(active.id);
                    ctx.ui.notify(briefs.length ? listWindow(briefs).map((brief) => `${brief.id}: ${brief.goal}\n` + brief.references.map((ref) =>
                        `${ref.status}: ${ref.url}\n${ref.title ?? 'Title unavailable'}; ${ref.retrievedAt}; SHA-256 ${ref.contentHash ?? 'unavailable'}\n${ref.notes.join('; ')}`).join('\n')).join('\n\n') : 'No research briefs in this course.', 'info');
                }
                else if (command === 'show' && params.length <= 1)
                    ctx.ui.notify(compactMap(graphs.get(active.id, params[0] ? Number(params[0]) : undefined)), 'info');
                else if (command === 'validate' && params.length <= 1)
                    ctx.ui.notify('Valid prerequisite DAG. Order: ' + graphs.validate(active.id, params[0] ? Number(params[0]) : undefined).join(', '), 'info');
                else if (command === 'activate' && params.length === 1) {
                    graphs.activate(active.id, Number(params[0]));
                    ctx.ui.notify(`Activated curriculum v${Number(params[0])}.`, 'info');
                }
                else if ((command === 'concept' || command === 'prerequisites') && (params.length === 1 || params.length === 2)) {
                    const info = graphs.inspect(active.id, params[0]!, params[1] ? Number(params[1]) : undefined);
                    ctx.ui.notify(command === 'prerequisites' ? `Prerequisites: ${info.prerequisites.join(', ') || 'none'}` :
                        `${info.node.title} [${info.node.type}]\n${info.node.summary}\n` + info.node.sourceRefs.map((ref) => `${ref.sourceId} v${ref.version}, ${formatAnchor(ref.anchor)} (${ref.segmentId})`).join('\n')
                            + '\n' + info.researchReferences.map((ref) => `${ref.title ?? 'Untitled reference'} — ${ref.url}\n${ref.id}; ${ref.authority}; retrieved ${ref.retrievedAt}; SHA-256 ${ref.contentHash}`).join('\n'), 'info');
                }
                else
                    ctx.ui.notify(usage, 'error');
            }
            catch (error) {
                ctx.ui.notify(error instanceof GraphError || error instanceof CourseError ? error.message : 'Curriculum operation failed. Retry or inspect the stored drafts.', 'error');
            }
        } });
}
