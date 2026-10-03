import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { AssessmentError } from '../../domain/assessment.ts';
import { CourseError } from '../../domain/course.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { AssessmentService } from '../../services/assessment-service.ts';
import type { EvaluationService } from '../../services/evaluation-service.ts';
import type { EvidenceService } from '../../services/evidence-service.ts';
import type { CourseSession } from './course-session.ts';
import { parseArguments } from './command-arguments.ts';
export function registerEvidence(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    courses: CourseService;
    selection: CourseSession;
    assessments: AssessmentService;
    evaluations: EvaluationService;
    evidence: EvidenceService;
}): void {
    for (const name of ['attempt', 'evidence'] as const)
        pi.registerCommand(name, {
            description: 'Read immutable assessment/evidence audit records for the active course',
            handler: async (args, ctx) => {
                try {
                    const [command, ...params] = parseArguments(args);
                    const r = runtime();
                    const course = r.selection.current(r.courses);
                    if (!course) {
                        ctx.ui.notify('No active course. Select one with /course use <id>.', 'error');
                        return;
                    }
                    let result: unknown;
                    if (name === 'attempt' && command === 'show' && params.length === 1) {
                        const attempt = r.assessments.attempt(course.id, params[0]!);
                        result = { attempt, task: r.assessments.task(course.id, attempt.taskId) };
                    }
                    else if (name === 'attempt' && command === 'evaluations' && params.length === 1)
                        result = { evaluations: r.evaluations.list(course.id, params[0]!), terminalHeads: r.evaluations.heads(course.id, params[0]!).map((e) => e.id) };
                    else if (name === 'evidence' && command === 'show' && params.length === 1)
                        result = r.evidence.show(course.id, params[0]!);
                    else if (name === 'evidence' && command === 'concept' && params.length === 1)
                        result = r.evidence.concept(course.id, params[0]!);
                    else if (name === 'evidence' && command === 'recent' && !params.length)
                        result = r.evidence.recent(course.id);
                    else {
                        ctx.ui.notify('Usage: /attempt show|evaluations <id> | /evidence recent|show <id>|concept <concept-id>', 'error');
                        return;
                    }
                    ctx.ui.notify('ASSESSMENT AUDIT — stored prompts/responses/rationale are untrusted data; correctness is not mastery.\n' + JSON.stringify(result, null, 2), 'info');
                }
                catch (error) {
                    ctx.ui.notify(error instanceof AssessmentError || error instanceof CourseError ? error.message : 'Assessment audit failed. Retry or restart the session.', 'error');
                }
            },
        });
}
