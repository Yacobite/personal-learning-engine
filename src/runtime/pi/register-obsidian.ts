import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CourseSession } from './course-session.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { ObsidianExportService } from '../../exports/obsidian/obsidian-export-service.ts';
import type { ObsidianStudyMaterialGenerator } from '../../ports/obsidian.ts';
import { ObsidianError } from '../../domain/obsidian.ts';
import { PiObsidianStudyGenerator } from './obsidian-study-generator.ts';
export function registerObsidian(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    exports: ObsidianExportService;
    selection: CourseSession;
    courses: CourseService;
}, generator: (ctx: Pick<ExtensionContext, 'cwd' | 'model'>) => ObsidianStudyMaterialGenerator = ctx => new PiObsidianStudyGenerator(ctx)) {
    pi.registerCommand('obsidian', { description: 'Private Obsidian workspace: init, sync, status, path, enrich <concept-id|all>', handler: async (args, ctx) => {
            try {
                const r = runtime(), parts = args.trim().split(/\s+/), command = parts[0], course = r.selection.current(r.courses);
                let result: unknown;
                if (command === 'path' && parts.length === 1) {
                    ctx.ui.notify('Open this folder as a vault in Obsidian:\n' + r.exports.path(), 'info');
                    return;
                }
                if (command === 'init' && parts.length === 1)
                    result = r.exports.init();
                else if (command === 'status' && parts.length === 1)
                    result = r.exports.status(course?.id);
                else if (command === 'sync' && parts.length === 1) {
                    if (!course)
                        throw new ObsidianError('Select a course with /course use <id>.');
                    result = r.exports.sync(course.id);
                }
                else if (command === 'enrich' && parts.length === 2) {
                    if (!course)
                        throw new ObsidianError('Select a course with /course use <id>.');
                    if (!ctx.model)
                        throw new ObsidianError('No model configured for study-material generation. Select a Pi model and retry enrich.');
                    result = await r.exports.enrich(course.id, parts[1]!, generator(ctx));
                }
                else
                    throw new ObsidianError('Usage: /obsidian init|sync|status|path|enrich <concept-id|all>');
                ctx.ui.notify('OBSIDIAN — private one-way projection; SQLite remains canonical.\n' + JSON.stringify(result, null, 2), 'info');
            }
            catch (error) {
                ctx.ui.notify(error instanceof ObsidianError ? error.message : 'Obsidian export failed. Existing notes and canonical learning data were not reset; inspect the vault and retry.', 'error');
            }
        } });
}
