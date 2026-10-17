import { listWindow } from './command-surface.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { CourseError } from '../../domain/course.ts';
import { SourceError } from '../../domain/source.ts';
import type { SourceAnchor } from '../../domain/source.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { SourceService } from '../../services/source-service.ts';
import type { CourseSession } from './course-session.ts';
import { parseArguments } from './command-arguments.ts';

const usage = 'Usage: /source add <path-or-URL> [--captions <path.vtt>] | list | status <source-id> [version] | search "terms" [source-id]';
export function formatAnchor(anchor: SourceAnchor): string {
  switch (anchor.kind) {
    case 'pdf': return `page ${anchor.page}`;
    case 'pptx': return `slide ${anchor.slide} (${anchor.part})`;
    case 'youtube': return `${anchor.startSeconds}–${anchor.endSeconds}s`;
    case 'text': return `text offsets ${anchor.startOffset}–${anchor.endOffset}`;
    case 'markdown': case 'web': return `${anchor.kind} section ${anchor.section}, offsets ${anchor.startOffset}–${anchor.endOffset}`;
  }
}
export function registerSource(pi: Pick<ExtensionAPI, 'registerCommand'>,
  getRuntime: () => { sources: SourceService; courses: CourseService; selection: CourseSession }): void {
  pi.registerCommand('source', {
    description: 'Ingest, inspect and search untrusted source material for the active course',
    handler: async (args, ctx) => {
      let tokens: string[];
      try { tokens = parseArguments(args); } catch { ctx.ui.notify(usage, 'error'); return; }
      try {
        const runtime = getRuntime();
        const active = runtime.selection.current(runtime.courses);
        if (!active) { ctx.ui.notify('No active course. Select one with /course use <id>.', 'error'); return; }
        const [command, ...params] = tokens;
        if (command === 'add' && (params.length === 1 || (params.length === 3 && params[1] === '--captions'))) {
          const result = await runtime.sources.ingest(active.id, { location: params[0]!,
            ...(params[2] ? { captionsPath: params[2] } : {}) });
          ctx.ui.notify(`${result.unchanged ? 'Unchanged' : 'Ingested'} ${result.source.id} v${result.version.version}: ${result.source.title}; ${result.version.status}; ${result.version.segments.length} segments.\n`
            + result.version.warnings.map((w) => `${w.anchor ? `${formatAnchor(w.anchor)}: ` : ''}${w.message}`).join('\n'), 'info');
        } else if (command === 'list' && !params.length) {
          const sources = runtime.sources.list(active.id);
          ctx.ui.notify(sources.length ? listWindow(sources).map((s) => `${s.id} v${s.currentVersion}: ${s.title} (${s.kind}, ${s.origin}, ${s.status})`).join('\n') : 'No sources in this course.', 'info');
        } else if (command === 'status' && (params.length === 1 || params.length === 2)) {
          const version = runtime.sources.status(active.id, params[0]!, params[1] ? Number(params[1]) : undefined);
          ctx.ui.notify(`${version.sourceId} v${version.version}: ${version.title}; ${version.status}\n`
            + `${version.location}\nSHA-256 ${version.contentHash}; ${version.ingestedAt}; ${version.parser}\n`
            + `${version.segments.length} segments\n` + version.warnings.map((w) => `${w.anchor ? `${formatAnchor(w.anchor)}: ` : ''}${w.message}`).join('\n'), 'info');
        } else if (command === 'search' && (params.length === 1 || params.length === 2)) {
          const results = runtime.sources.search(active.id, params[0]!, params[1] ? { sourceId: params[1] } : {});
          ctx.ui.notify(results.length ? 'SOURCE DATA (untrusted)\n' + results.map((r) =>
            `${r.source.title} [${r.source.kind}, ${r.source.origin}] — ${r.source.id} v${r.segment.version}, ${formatAnchor(r.segment.anchor)}; rank ${r.rank}\n`
            + `${r.location}\n${r.segment.text.slice(0, 1000)}`).join('\n\n') : 'No matching current-version source segments.', 'info');
        } else ctx.ui.notify(usage, 'error');
      } catch (error) {
        ctx.ui.notify(error instanceof SourceError || error instanceof CourseError ? error.message
          : 'Source operation failed. Please retry or restart the session.', 'error');
      }
    },
  });
}
