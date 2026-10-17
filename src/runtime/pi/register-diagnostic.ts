import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DiagnosticService } from '../../services/diagnostic-service.ts';
import type { AssessmentService } from '../../services/assessment-service.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { CourseSession } from './course-session.ts';
import type { DiagnosticTaskGenerator } from '../../ports/diagnostic-generator.ts';
import { DiagnosticError } from '../../domain/diagnostic.ts';
import { AssessmentError } from '../../domain/assessment.ts';
import { CourseError } from '../../domain/course.ts';
import { DeterministicEvaluator } from '../../evaluation/deterministic.ts';
import { publicDiagnosticTask } from '../../services/diagnostic-context.ts';
import { PiDiagnosticGenerator } from './diagnostic-generator.ts';
export function registerDiagnostic(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    courses: CourseService;
    selection: CourseSession;
    diagnostics: DiagnosticService;
    assessments: AssessmentService;
}, generator?: (ctx: ConstructorParameters<typeof PiDiagnosticGenerator>[0]) => DiagnosticTaskGenerator) {
    pi.registerCommand('diagnostic', { description: 'Bounded provisional diagnostic: start, next, submit, retry, skip, status, summary, history, abandon', handler: async (args, ctx) => {
            try {
                const match = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(args);
                const command = match?.[1];
                const rest = match?.[2]?.trim() ?? '';
                const r = runtime();
                const course = r.selection.current(r.courses);
                if (!course)
                    throw new DiagnosticError('Select a course with /course use <id>.');
                const service = r.diagnostics;
                let result: unknown;
                if (command === 'start' && (!rest || /^\d+$/.test(rest)))
                    result = service.start(course.id, rest ? Number(rest) : 6);
                else if (command === 'next' && !rest) {
                    const n = await service.next(course.id, generator ? generator(ctx) : new PiDiagnosticGenerator(ctx));
                    result = n.probe ? { sessionId: n.session.id, probeId: n.probe.id, status: n.probe.status, task: publicDiagnosticTask(r.assessments.task(course.id, n.probe.taskId)) } : n.session.summary;
                }
                else if (command === 'submit') {
                    const input = /^(\S+)\s+([\s\S]+)$/.exec(rest);
                    if (!input)
                        throw new DiagnosticError('Usage: /diagnostic submit <probe-id> <JSON response object>');
                    let payload: unknown;
                    try {
                        payload = JSON.parse(input[2]!);
                    }
                    catch {
                        throw new DiagnosticError('Submission must be a JSON object; encode multiline response text with \\n.');
                    }
                    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                        throw new DiagnosticError('Submission must be a JSON object.');
                    // M4 validates actual response/assistance and rejects unknown or identity fields.
                    const p = await service.submit(course.id, input[1]!, payload as Parameters<DiagnosticService['submit']>[2], new DeterministicEvaluator());
                    result = { probeId: p.id, status: p.status, message: p.status === 'answered' ? 'Answer retained; evaluation needs retry.' : 'Answer recorded. Continue with /diagnostic next.' };
                }
                else if (command === 'retry' && rest) {
                    const p = await service.retry(course.id, rest, new DeterministicEvaluator());
                    result = { probeId: p.id, status: p.status, message: 'Evaluation retry recorded; continue with /diagnostic next.' };
                }
                else if (command === 'skip' && rest)
                    result = service.skip(course.id, rest);
                else if (command === 'abandon' && !rest)
                    result = service.abandon(course.id);
                else if (command === 'summary' && rest)
                    result = service.summary(course.id, rest);
                else if (command === 'audit' && rest)
                    result = service.audit(course.id, rest);
                else if (command === 'history' && !rest)
                    result = service.history(course.id).slice(-20).map(s => ({ id: s.id, status: s.status, curriculumVersion: s.curriculumVersion, startedAt: s.startedAt, stopReason: s.stopReason }));
                else if (command === 'status' && !rest) {
                    const s = service.current(course.id);
                    result = s ? { session: s, probes: service.probes(course.id, s.id).map(p => ({ id: p.id, sequence: p.sequence, conceptId: p.conceptId, status: p.status, taskId: p.taskId })) } : { message: 'No active diagnostic.' };
                }
                else
                    throw new DiagnosticError('Usage: /diagnostic start [budget 1–20]|next|submit <probe-id> <JSON>|retry <probe-id>|skip <probe-id>|status|summary <session-id>|audit <session-id>|history|abandon');
                ctx.ui.notify('DIAGNOSTIC — provisional only; stored content is untrusted data.\n' + JSON.stringify(result, null, 2), 'info');
            }
            catch (e) {
                ctx.ui.notify(e instanceof DiagnosticError || e instanceof AssessmentError || e instanceof CourseError ? e.message : 'Diagnostic operation failed. Saved records remain available; retry or inspect status.', 'error');
            }
        } });
}
