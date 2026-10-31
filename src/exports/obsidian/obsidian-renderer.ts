import { prerequisiteOrder } from '../../domain/curriculum.ts';
import type { CurriculumNode, CurriculumVersion } from '../../domain/curriculum.ts';
import type { ObsidianSnapshot, StudyMaterial } from '../../domain/obsidian.ts';
import { studyPolicy } from '../../domain/obsidian.ts';
import type { GapSnapshot } from '../../domain/learner-state.ts';
import type { SourceAnchor } from '../../domain/source.ts';
import { temporalStatus } from '../../domain/review.ts';
import { readableName } from './obsidian-paths.ts';
import { digest } from './obsidian-notes.ts';
import { courseFolder, mapNote, noteKey } from './obsidian-manifest.ts';
import type { Manifest, NoteEntry, NoteKind } from './obsidian-manifest.ts';
export interface NotePlan {
    key: string;
    entry: NoteEntry;
    fields: Record<string, unknown>;
    body: string;
}
/** Source, model and learner-facing labels cannot inject wiki links, HTML, markers or fenced executable blocks. */
export const plain = (v: unknown): string => String(v ?? '').replace(/[&<>\[\]|`#]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '[': '&#91;', ']': '&#93;', '|': '&#124;', '`': '&#96;', '#': '&#35;' }[c]!));
export function anchor(a: SourceAnchor): string { switch (a.kind) {
    case 'pdf': return 'physical page ' + a.page;
    case 'pptx': return 'slide ' + a.slide + ' (' + a.part + ')';
    case 'youtube': return 'timestamp ' + a.startSeconds + '–' + a.endSeconds + ' seconds';
    case 'text': return 'text offsets ' + a.startOffset + '–' + a.endOffset;
    default: return a.kind + ' section ' + a.section + '; offsets ' + a.startOffset + '–' + a.endOffset;
} }
export const materialKey = (courseId: string, conceptId: string) => courseId + ':' + conceptId;
export function materialFingerprint(s: ObsidianSnapshot, n: CurriculumNode): string { return digest(JSON.stringify({ policy: studyPolicy, course: s.course.id, version: s.graph.version, node: n, sources: n.sourceRefs.map(r => s.sources.find(v => v.sourceId === r.sourceId && v.version === r.version)?.contentHash ?? null), research: n.researchRefs.map(r => s.research.find(v => v.briefId === r.briefId && v.id === r.referenceId)?.contentHash ?? null) })); }
export function wiki(m: Manifest, kind: NoteKind, courseId: string | null, id: string, label: string): string {
    const n = m.notes[noteKey(kind, courseId, id)];
    return n ? '[[' + n.path.replace(/\.md$/, '') + '|' + plain(label).replace(/\r?\n/g, ' ') + ']]' : plain(label) + ' (' + plain(id) + ')';
}
function materialBody(material: StudyMaterial | undefined, status: string) {
    let out = 'Study material status: **' + status + '**. Grounded synthesis, not source truth, curriculum authority or evidence.\n';
    if (!material)
        return out + '\nNo generated explanation yet. Use explicit /obsidian enrich with a configured model.\n';
    for (const [k, v] of Object.entries(material))
        if (!['sourceRefs', 'researchRefs', 'selfCheckPrompts'].includes(k) && v !== undefined)
            out += '\n### ' + plain(k) + '\n\n' + (Array.isArray(v) ? v.map(x => '- ' + plain(x)).join('\n') : plain(v)) + '\n';
    if (material.selfCheckPrompts?.length)
        out += '\n### Private self-check prompts\n\nThese prompts are for private self-study in Obsidian. Answers written here are not recorded as learner performance.\n\n' + material.selfCheckPrompts.map(p => '- ' + plain(p)).join('\n') + '\n';
    return out;
}
export function buildPlans(m: Manifest, s?: ObsidianSnapshot): NotePlan[] {
    const plans: NotePlan[] = [];
    const cid = s?.course.id ?? null;
    function add(kind: NoteKind, id: string, title: string, path: string, fields: Record<string, unknown>, body: string) { const n = mapNote(m, kind, kind === 'home' ? null : cid, id, title, path); plans.push({ key: noteKey(kind, kind === 'home' ? null : cid, id), entry: n, fields: { note_kind: kind, course_id: kind === 'home' ? null : cid, entity_id: id, title, aliases: n.aliases, tags: ['learning-engine', 'learning-engine/' + kind], ...fields }, body }); }
    if (s) {
        const id = s.course.id, folder = courseFolder(m, id, s.course.title), concepts = new Map<string, {
            node: CurriculumNode;
            graph: CurriculumVersion;
            active: boolean;
        }>();
        for (const n of s.graph.nodes)
            concepts.set(n.conceptId, { node: n, graph: s.graph, active: true });
        for (const entry of Object.values(m.notes).filter(n => n.kind === 'concept' && n.courseId === id && !concepts.has(n.id))) {
            const old = [...s.versions].reverse().find(v => v.nodes.some(n => n.conceptId === entry.id));
            if (old)
                concepts.set(entry.id, { node: old.nodes.find(n => n.conceptId === entry.id)!, graph: old, active: false });
        }
        const gaps = new Map<string, GapSnapshot>();
        for (const state of s.history)
            for (const gap of state.gaps)
                gaps.set(gap.id, gap);
        for (const gap of s.state?.gaps ?? [])
            gaps.set(gap.id, gap);
        const setup = (kind: NoteKind, entity: string, title: string, path: string) => mapNote(m, kind, id, entity, title, path);
        setup('course', id, s.course.title, folder + '/Dashboard.md');
        setup('reviews', id, 'Review Queue', folder + '/Review Queue.md');
        for (const { node: n } of concepts.values())
            setup('concept', n.conceptId, n.title, folder + '/Concepts/' + readableName(n.title, n.conceptId) + '.md');
        for (const source of s.sources)
            setup('source', source.sourceId + '@' + source.version, source.title, folder + '/Sources/' + readableName(source.title, source.sourceId) + '-v' + source.version + '.md');
        for (const r of s.research)
            setup('research', r.briefId + ':' + r.id, r.title ?? 'Research', folder + '/Sources/' + readableName(r.title ?? 'Research', r.id) + '-' + digest(r.briefId).slice(0, 8) + '.md');
        for (const g of gaps.values())
            setup('gap', g.id, g.dimension + ' ' + g.status, folder + '/Gaps/' + readableName(g.dimension, g.id) + '.md');
        for (const d of s.diagnostics)
            setup('diagnostic', d.session.id, 'Diagnostic', folder + '/Sessions/Diagnostics/' + d.session.id + '.md');
        for (const t of s.teaching)
            setup('teaching', t.session.id, 'Teaching', folder + '/Sessions/Teaching/' + t.session.id + '.md');
        const link = (conceptId: string) => wiki(m, 'concept', id, conceptId, concepts.get(conceptId)?.node.title ?? conceptId);
        const currentGaps = s.state?.gaps ?? [], pending = s.reviews.filter(r => ['scheduled', 'active', 'awaiting_evaluation'].includes(r.status));
        const stages: Record<string, number> = {};
        for (const r of s.state?.readiness ?? [])
            stages[r.stage] = (stages[r.stage] ?? 0) + 1;
        m.courses[id] = { ...m.courses[id]!, title: s.course.title, mode: s.course.mode, version: s.graph.version, stages, due: pending.filter(i => s.at >= i.earliestAt).length, gaps: currentGaps.filter(g => g.status !== 'VERIFIED_CLOSED').length };
        const order = prerequisiteOrder(s.graph.nodes.map(n => n.conceptId), s.graph.edges);
        const sessionLinks = [...s.diagnostics.slice(-10).map(d => wiki(m, 'diagnostic', id, d.session.id, 'Diagnostic ' + d.session.status)), ...s.teaching.slice(-10).map(t => wiki(m, 'teaching', id, t.session.id, 'Teaching ' + t.session.status))];
        add('course', id, s.course.title, folder + '/Dashboard.md', { curriculum_version: s.graph.version }, '# ' + plain(s.course.title) + '\n\nObjective: ' + plain(s.course.objective) + '\n\nMode: ' + s.course.mode + '; active curriculum v' + s.graph.version + '.\n\n## Stored learner state\n\n' + (s.state ? 'Revision ' + s.state.id + '; as-of ' + s.state.asOf + '.\n\n' + Object.entries(stages).map(([k, v]) => '- ' + k + ': ' + v).join('\n') : 'No stored M7 revision. Inspect /state in Pi when you want to calculate one; exporting does not refresh it.') + '\n\nOpen/repair/awaiting gaps: ' + m.courses[id]!.gaps + '; due/overdue reviews: ' + m.courses[id]!.due + '.\n\n' + wiki(m, 'reviews', id, id, 'Review Queue') + '\n\n## Sessions\n\n' + sessionLinks.join('\n\n') + '\n\n## Recommended/current concepts\n\n' + [...new Set([...s.diagnostics.flatMap(d => d.session.summary?.frontier.map(f => f.conceptId) ?? []), ...s.teaching.flatMap(t => t.session.recommendations)])].slice(0, 20).map(link).join('\n\n') + '\n\n## Concept index — prerequisite order\n\n' + order.map(link).join('\n\n'));
        for (const { node: n, graph: g, active } of concepts.values()) {
            const readiness = active ? s.state?.readiness.find(r => r.conceptId === n.conceptId) : null, dimensions = active ? s.state?.dimensions.filter(d => d.conceptId === n.conceptId) ?? [] : [];
            const cache = m.materials[materialKey(id, n.conceptId)], status = !cache ? 'missing' : !active || cache.fingerprint !== materialFingerprint(s, n) ? 'stale' : 'current';
            const incoming = g.edges.filter(e => e.type === 'prerequisite_of' && e.to === n.conceptId), outgoing = g.edges.filter(e => e.type === 'prerequisite_of' && e.from === n.conceptId), related = g.edges.filter(e => e.type !== 'prerequisite_of' && (e.from === n.conceptId || e.to === n.conceptId));
            const source = n.sourceRefs.map(r => '- ' + wiki(m, 'source', id, r.sourceId + '@' + r.version, r.sourceId + ' v' + r.version) + '; segment ' + plain(r.segmentId) + '; ' + anchor(r.anchor) + '; typed anchor ' + plain(JSON.stringify(r.anchor))).join('\n');
            const research = n.researchRefs.map(r => '- ' + wiki(m, 'research', id, r.briefId + ':' + r.referenceId, r.referenceId) + '; brief ' + r.briefId).join('\n');
            add('concept', n.conceptId, n.title, m.notes[noteKey('concept', id, n.conceptId)]!.path, { concept_id: n.conceptId, curriculum_version: g.version, concept_type: n.type, stage: readiness?.stage ?? null, active, material_status: status }, '# ' + plain(n.title) + '\n\n' + (active ? 'Active curriculum concept.' : '**Historical/inactive concept.** Removed from the current active curriculum; notes and original provenance are retained.') + '\n\n## Core idea\n\n' + plain(n.summary) + '\n\n## Study material\n\n' + materialBody(cache?.material, status) + '\n## Prerequisites\n\n' + incoming.map(e => '- ' + link(e.from)).join('\n') + '\n\n## Dependents\n\n' + outgoing.map(e => '- ' + link(e.to)).join('\n') + '\n\n## Related concepts\n\n' + related.map(e => '- ' + e.type + ': ' + link(e.from) + ' → ' + link(e.to) + '; ' + plain(e.rationale)).join('\n') + '\n\nOnly prerequisite_of implies dependency ordering; other cycles are valid.\n\n## Source / research provenance\n\n### Learner course sources\n\n' + (source || 'None.') + '\n\n### Authoritative / secondary research\n\n' + (research || 'None.') + '\n\n## Your current learning state\n\nStage: ' + (readiness?.stage ?? 'no stored active projection') + '\n\n' + (s.state ? 'Stored revision ' + s.state.id + '; as-of ' + s.state.asOf + '.' : 'State has not been calculated.') + '\n\n| Dimension | Status | Independent success / failure | Assisted success / failure | AI / unscored |\n| --- | --- | --- | --- | --- |\n' + dimensions.map(d => '| ' + d.dimension + ' | ' + d.band + ' | ' + d.independentSuccessCount + ' / ' + d.independentFailureCount + ' | ' + d.assistedSuccessCount + ' / ' + d.assistedFailureCount + ' | ' + d.aiPerformedCount + ' / ' + d.unscoredCount + ' |').join('\n') + '\n\n## Missing evidence\n\n' + (readiness ? 'For provisional: ' + plain(readiness.missingProvisional.join(', ') || 'none') + '\n\nFor durable: ' + plain(readiness.missingDurable.join(', ') || 'none') + '\n\nDelayed verification: ' + readiness.delayed.status + '; eligible after ' + (readiness.delayed.eligibleAfter ?? 'not established') : 'No stored assessment projection; no competence is inferred.') + '\n\n## Current gaps\n\n' + currentGaps.filter(g => g.conceptId === n.conceptId).map(g => wiki(m, 'gap', id, g.id, g.dimension + ' ' + g.status)).join('\n\n') + '\n\n## Review\n\n' + pending.filter(i => i.conceptId === n.conceptId).slice(0, 20).map(i => '- ' + i.id + ': ' + i.kind + '; ' + i.dimension + '; ' + temporalStatus(i, s.at) + '; earliest ' + i.earliestAt + '; due ' + i.dueAt).join('\n') + '\n\n' + wiki(m, 'reviews', id, id, 'Review Queue') + '\n\n## Practice with the tutor\n\nSelect this course in Pi first: `/course use ' + id + '`.\n\nTracked practice: `/teach start ' + JSON.stringify({ conceptId: n.conceptId }) + '`\n\nState: `/state concept ' + n.conceptId + '`\n\nReadiness: `/readiness concept ' + n.conceptId + '`\n\nEditing this note never records performance or changes mastery.');
        }
        for (const v of s.sources) {
            const refs = [...concepts.values()].flatMap(({ node }) => node.sourceRefs.filter(r => r.sourceId === v.sourceId && r.version === v.version).map(r => '- ' + link(node.conceptId) + '; ' + plain(r.segmentId) + '; ' + anchor(r.anchor) + '; ' + plain(JSON.stringify(r.anchor))));
            add('source', v.sourceId + '@' + v.version, v.title, m.notes[noteKey('source', id, v.sourceId + '@' + v.version)]!.path, { source_id: v.sourceId, source_version: v.version }, '# Learner course source: ' + plain(v.title) + '\n\n' + v.sourceId + ' v' + v.version + '; type ' + v.kind + '; origin ' + v.origin + '; extraction ' + v.status + '.\n\nLocation: ' + plain(v.location) + '\n\nSHA-256: ' + v.contentHash + '\n\n## Referenced anchors\n\n' + refs.join('\n') + '\n\nExtraction warnings: ' + plain(v.warnings.map(w => w.code).join(', ')) + '\n\nOriginal source text is not duplicated in this note.');
        }
        for (const r of s.research)
            add('research', r.briefId + ':' + r.id, r.title ?? 'Research', m.notes[noteKey('research', id, r.briefId + ':' + r.id)]!.path, { reference_id: r.id, brief_id: r.briefId }, '# Research provenance: ' + plain(r.title ?? 'Untitled') + '\n\n' + r.id + '; brief ' + r.briefId + '\n\nPublisher: ' + plain(r.publisher) + '\n\nURL: ' + plain(r.url) + '\n\nRetrieved: ' + r.retrievedAt + '; authority ' + r.authority + '; status ' + r.status + '; SHA-256 ' + (r.contentHash ?? 'unavailable') + '\n\nThis is external research, not learner-provided source material or generated synthesis.');
        for (const g of gaps.values())
            add('gap', g.id, g.dimension + ' ' + g.status, m.notes[noteKey('gap', id, g.id)]!.path, { gap_id: g.id, lifecycle: g.status, current: currentGaps.some(x => x.id === g.id) }, '# Gap: ' + g.dimension + '\n\n' + g.id + '\n\nConcept: ' + link(g.conceptId) + '\n\nLifecycle: **' + g.status + '**' + (currentGaps.some(x => x.id === g.id) ? '' : ' (historical belief; not present in current revision)') + '\n\nTrigger attempt: ' + g.triggerAttemptId + '\n\nEligible after: ' + (g.eligibleAfter ?? 'not established') + '\n\nRecurs from: ' + (g.recursFrom ? wiki(m, 'gap', id, g.recursFrom, g.recursFrom) : 'none') + '\n\n## Trigger / repair / verification history\n\n' + g.transitions.map(t => '- ' + t.status + ' at ' + t.at + '; ' + t.reason + '; assistance ' + t.assistance + '; attempt ' + t.ref.attemptId + '; evaluation ' + t.ref.evaluationId + '; evidence ' + (t.ref.evidenceId ?? 'none')).join('\n') + '\n\nClosing or editing this note never closes a canonical gap.');
        let queue = '# Review Queue\n\nStored scheduling intent only. Overdue means an observation is late; it does not mean forgotten. Sync does not refresh or complete reviews.\n';
        for (const temporal of ['overdue', 'due', 'upcoming'] as const) {
            const items = pending.filter(i => temporalStatus(i, s.at) === temporal).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
            queue += '\n## ' + temporal + ' (' + items.length + ')\n\n' + items.slice(0, 20).map(i => '- ' + link(i.conceptId) + '; ' + i.id + '; ' + i.kind + '; dimension ' + i.dimension + '; earliest ' + i.earliestAt + '; due ' + i.dueAt + '; spacing stage ' + i.stage + '; ' + i.status).join('\n') + '\n';
        }
        queue += '\n## Repair needed\n\n' + currentGaps.filter(g => ['OPEN', 'REPAIR_IN_PROGRESS'].includes(g.status)).slice(0, 20).map(g => '- ' + link(g.conceptId) + '; ' + wiki(m, 'gap', id, g.id, g.dimension + ' ' + g.status)).join('\n') + '\n\nContinue in Pi: `/review next`; use teaching for repair.';
        add('reviews', id, 'Review Queue', folder + '/Review Queue.md', { curriculum_version: s.graph.version }, queue);
        for (const d of s.diagnostics)
            add('diagnostic', d.session.id, 'Diagnostic', m.notes[noteKey('diagnostic', id, d.session.id)]!.path, { session_id: d.session.id, curriculum_version: d.session.curriculumVersion }, '# Diagnostic session\n\n' + d.session.id + '; curriculum v' + d.session.curriculumVersion + '; status ' + d.session.status + '; stop ' + (d.session.stopReason ?? 'in progress') + '\n\n## Probes and evidence\n\n' + d.probes.map(p => '- ' + link(p.conceptId) + '; ' + p.id + '; ' + p.status + '; performance ' + plain(p.attemptId ? s.performance[p.attemptId]?.assistance + ' / ' + s.performance[p.attemptId]?.outcome : 'none') + '; attempt ' + (p.attemptId ?? 'none') + '; ' + p.outcomes.map(o => 'evaluation ' + o.evaluationId + ' / evidence ' + (o.evidenceId ?? 'none')).join('; ')).join('\n') + '\n\n## Provisional findings\n\n' + (d.session.summary?.findings.map(f => '- ' + link(f.conceptId) + ': ' + f.state).join('\n') ?? 'No completed summary.') + '\n\n## Frontier\n\n' + (d.session.summary?.frontier.map(f => link(f.conceptId)).join('\n\n') ?? 'Not finalized.') + '\n\nDiagnostic findings recommend instruction; they do not establish mastery. Learner response bodies are excluded.');
        for (const t of s.teaching)
            add('teaching', t.session.id, 'Teaching', m.notes[noteKey('teaching', id, t.session.id)]!.path, { session_id: t.session.id, curriculum_version: t.session.curriculumVersion }, '# Teaching session\n\n' + t.session.id + '; curriculum v' + t.session.curriculumVersion + '; status ' + t.session.status + '; stop ' + (t.session.summary?.stopReason ?? 'in progress') + '\n\nDiagnostic: ' + (t.session.diagnosticId ?? 'none') + '\n\n## Moves, support and evidence\n\n' + t.moves.map(move => '- ' + link(move.conceptId) + '; ' + move.type + '; scaffold level ' + move.level + '; actual assistance/outcome ' + plain(move.attemptId ? s.performance[move.attemptId]?.assistance + ' / ' + s.performance[move.attemptId]?.outcome : 'no performance') + '; ' + move.status + '; reason ' + plain(move.reason) + '; attempt ' + (move.attemptId ?? 'none') + '; ' + move.outcomes.map(o => 'evaluation ' + o.evaluationId + ' / evidence ' + (o.evidenceId ?? 'none')).join('; ')).join('\n') + '\n\n## Session-local outcomes\n\n' + (t.session.summary?.outcomes.map(o => link(o.conceptId) + ': ' + o.outcome).join('\n\n') ?? 'Not finalized.') + '\n\nSession completion is not mastery. Source bodies, scoring keys and learner responses are excluded.');
    }
    const home = '# Learning workspace\n\nSQLite is canonical. These notes are a one-way projection; Markdown edits never mark mastery, create evidence, close gaps, activate curriculum or complete reviews. Open this folder as an Obsidian vault; no plugin is needed.\n\n' + Object.entries(m.courses).sort(([a], [b]) => a.localeCompare(b)).map(([id, c]) => '- ' + wiki(m, 'course', id, id, c.title) + '; ' + plain(c.mode) + '; curriculum v' + c.version + '; stages ' + plain(JSON.stringify(c.stages)) + '; due reviews ' + c.due + '; unresolved gaps ' + c.gaps + ' (last exported snapshot)').join('\n');
    add('home', 'home', 'Learning workspace', 'Home.md', {}, home);
    return plans;
}
