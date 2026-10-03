import type { AssessmentTask, Attempt, EvaluatorIdentity } from '../domain/assessment.ts';
/** Providers return proposals only. Source/response text is untrusted data, not policy.
 * No repository, learner history, credentials or mutation capability is supplied.
 * A future live adapter must resolve only these task provenance links as source context.
 */
export interface AnswerEvaluator {
    readonly identity: EvaluatorIdentity;
    evaluate(input: {
        readonly task: AssessmentTask;
        readonly attempt: Attempt;
    }): Promise<unknown>;
}
