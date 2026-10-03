import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TeachingService } from '../../services/teaching-service.ts';
import type { AssessmentService } from '../../services/assessment-service.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { CourseSession } from './course-session.ts';
import { PiTeachingGenerator } from './teaching-generator.ts';
import { DeterministicEvaluator } from '../../evaluation/deterministic.ts';
import { publicDiagnosticTask } from '../../services/diagnostic-context.ts';
import { TeachingError } from '../../domain/teaching.ts';
import type { TeachingContentGenerator } from '../../ports/teaching-generator.ts';
export function registerTeaching(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    courses: CourseService;
    selection: CourseSession;
    teaching: TeachingService;
    assessments: AssessmentService;
}, generator?: (ctx: ConstructorParameters<typeof PiTeachingGenerator>[0]) => TeachingContentGenerator) {
    pi.registerCommand('teach', { description: 'Grounded session-local teaching: start, next, answer, hint, retry, status, summary, audit, history, abandon', handler: async (args, ctx) => {
            try {
                const match = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(args);
                const command = match?.[1];
                const rest = match?.[2]?.trim() ?? '';
                const r = runtime();
                const course = r.selection.current(r.courses);
                if (!course)
                    throw new TeachingError('Select a course first.');
                const s = r.teaching;
                let result: unknown;
                const generate = () => generator ? generator(ctx) : new PiTeachingGenerator(ctx);
                if (command === 'start')
                    result = s.start(course.id, rest ? JSON.parse(rest) : {});
                else if ((command === 'next' || command === 'hint') && !rest) {
                    const n = command === 'next' ? await s.next(course.id, generate()) : await s.hint(course.id, generate());
                    result = n.move ? { sessionId: n.session.id, moveId: n.move.id, type: n.move.type, reason: n.move.reason, level: n.move.level, status: n.move.status, content: n.move.content, task: n.move.taskId ? publicDiagnosticTask(r.assessments.task(course.id, n.move.taskId)) : null } : n.session.summary;
                }
                else if (command === 'answer') {
                    const input = /^(\S+)\s+([\s\S]+)$/.exec(rest);
                    if (!input)
                        throw new TeachingError('Usage: /teach answer <move-id> {"response":"paragraphs\\ncode"}');
                    const m = await s.answer(course.id, input[1]!, JSON.parse(input[2]!), new DeterministicEvaluator());
                    result = { moveId: m.id, status: m.status, message: m.status === 'answered' ? 'Response retained; retry evaluation.' : 'Response recorded; /teach next chooses the instructional response.' };
                }
                else if (command === 'retry' && rest) {
                    const m = await s.retry(course.id, rest, new DeterministicEvaluator());
                    result = { moveId: m.id, status: m.status };
                }
                else if (command === 'status' && !rest) {
                    const session = s.current(course.id);
                    result = session ? { session, moves: s.moves(course.id, session.id).map(m => ({ id: m.id, type: m.type, conceptId: m.conceptId, status: m.status, level: m.level })) } : { message: 'No active teaching session.' };
                }
                else if (command === 'history' && !rest)
                    result = s.history(course.id).map(v => ({ id: v.id, status: v.status, curriculumVersion: v.curriculumVersion }));
                else if (command === 'summary' && rest)
                    result = s.summary(course.id, rest);
                else if (command === 'audit' && rest)
                    result = s.audit(course.id, rest);
                else if (command === 'abandon' && !rest)
                    result = s.abandon(course.id);
                else
                    throw new TeachingError('Usage: /teach start [JSON options]|next|answer <move-id> <JSON>|hint|retry <move-id>|status|summary <session-id>|audit <session-id>|history|abandon');
                ctx.ui.notify('TEACHING — session-local; displayed course/learner content is untrusted data.\n' + JSON.stringify(result, null, 2), 'info');
            }
            catch (e) {
                ctx.ui.notify(e instanceof TeachingError ? e.message : 'Teaching operation failed; saved records remain available. Inspect status or retry.', 'error');
            }
        } });
}
