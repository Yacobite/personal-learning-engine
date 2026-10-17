import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { HealthService } from '../../services/health-service.ts';
import { HealthError } from '../../domain/health.ts';
export const learningHelp = `Learning engine — explicit workflows; small questions can stay normal chat.
COURSES: /course new|list|use|current
SOURCES: /source add|list|status|search
CURRICULUM: /curriculum build|show|list|validate|activate|concept|research
DIAGNOSTIC: /diagnostic start|next|submit|retry|skip|status|history|summary|audit|abandon
TEACHING: /teach start|next|answer|hint|retry|status|summary|audit|history|abandon
AUDIT: /attempt show|evaluations; /evidence recent|show|concept
STATE: /state; /readiness; /gaps (evidence-driven estimates)
REVIEW: /review; /review next|answer|retry|status|history|show
HEALTH: /learning-status; /learning-doctor; /learning-help
Flow: choose course → add sources OR build supported generated curriculum → inspect/activate → diagnose if appropriate → teach → inspect readiness/gaps → review when due.
Generation needs a configured model; inspection, local grading and queues do not. Python research is bounded to approved official-documentation seeds. No semantic teach-back grading or automatic mastery.
Lists/displays are bounded; use a specific course/concept/task/review ID for detail. README documents syntax, cloud-model disclosure, recovery and local backup.`;
export function registerHealth(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    health: HealthService;
    activeCourseId?: string;
}) {
    pi.registerCommand('learning-help', { description: 'Show compact learning workflows and actual command groups', handler: async (_args, ctx) => { ctx.ui.notify(learningHelp, 'info'); } });
    pi.registerCommand('learning-doctor', { description: 'Read-only SQLite integrity, FK, migration and subsystem inspection', handler: async (args, ctx) => {
            try {
                if (args.trim())
                    throw new HealthError('Usage: /learning-doctor');
                const r = runtime();
                const result = r.health.inspect(r.activeCourseId);
                ctx.ui.notify('LEARNING HEALTH — local read-only inspection\n' + JSON.stringify(result, null, 2), result.healthy ? 'info' : 'error');
            }
            catch (error) {
                ctx.ui.notify(error instanceof HealthError ? error.message : 'Health inspection unavailable. Preserve the database; inspect startup diagnostics. No data was reset.', 'error');
            }
        } });
}
