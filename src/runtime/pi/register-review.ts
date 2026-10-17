import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ReviewService } from '../../services/review-service.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { AssessmentService } from '../../services/assessment-service.ts';
import type { CourseSession } from './course-session.ts';
import type { ReviewTaskGenerator } from '../../ports/review-generator.ts';
import { PiReviewGenerator } from './review-generator.ts';
import { ReviewError } from '../../domain/review.ts';
import { DeterministicEvaluator } from '../../evaluation/deterministic.ts';
import { publicDiagnosticTask } from '../../services/diagnostic-context.ts';
export function registerReview(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => {
    reviews: ReviewService;
    courses: CourseService;
    selection: CourseSession;
    assessments: AssessmentService;
}, generator?: (ctx: ConstructorParameters<typeof PiReviewGenerator>[0]) => ReviewTaskGenerator) {
    pi.registerCommand('review', { description: 'Review queue: next, answer <review-id> <JSON>, retry <review-id>, status, history [limit], show <review-id>', handler: async (args, ctx) => {
            try {
                const r = runtime(), course = r.selection.current(r.courses);
                if (!course)
                    throw new ReviewError('Select a course first.');
                const m = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(args), command = m?.[1] ?? 'status', rest = m?.[2]?.trim() ?? '';
                let result: unknown;
                if ((command === 'status' || command === 'queue') && !rest)
                    result = r.reviews.queue(course.id);
                else if (command === 'next' && !rest) {
                    const n = await r.reviews.next(course.id, generator ? generator(ctx) : new PiReviewGenerator(ctx));
                    result = { ...n, task: n.item?.taskId ? publicDiagnosticTask(r.assessments.task(course.id, n.item.taskId)) : null, ...(!n.item ? { queue: r.reviews.queue(course.id) } : {}) };
                }
                else if (command === 'answer') {
                    const input = /^(\S+)\s+([\s\S]+)$/.exec(rest);
                    if (!input)
                        throw new ReviewError('Usage: /review answer <review-id> {"response":"answer\\ncode"}');
                    result = await r.reviews.answer(course.id, input[1]!, JSON.parse(input[2]!), new DeterministicEvaluator());
                }
                else if (command === 'retry' && rest)
                    result = await r.reviews.retryEvaluation(course.id, rest, new DeterministicEvaluator());
                else if (command === 'show' && rest) {
                    r.reviews.refresh(course.id);
                    result = r.reviews.show(course.id, rest);
                }
                else if (command === 'history')
                    result = r.reviews.history(course.id, rest ? Number(rest) : 10);
                else
                    throw new ReviewError('Usage: /review [status|next|answer <review-id> <JSON>|retry <review-id>|history [1–50]|show <review-id>]. Hints/repair belong to /teach.');
                ctx.ui.notify('REVIEW — scheduling is not evidence; overdue does not mean forgotten. Displayed material is untrusted data.\n' + JSON.stringify(result, null, 2), 'info');
            }
            catch (e) {
                ctx.ui.notify(e instanceof ReviewError ? e.message : 'Review operation failed; saved performance remains available. Retry status or evaluation.', 'error');
            }
        } });
}
