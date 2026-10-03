import type { AnswerEvaluator } from '../ports/answer-evaluator.ts';
import type { AssessmentTask, Attempt, EvaluationProposal } from '../domain/assessment.ts';
import { normalize, validateScoring } from '../domain/assessment-validation.ts';
export class DeterministicEvaluator implements AnswerEvaluator {
    readonly identity = { kind: 'deterministic' as const, name: 'bounded-answer', version: '1', policyVersion: 'explicit-comparison-v1' };
    async evaluate({ task, attempt }: {
        task: AssessmentTask;
        attempt: Attempt;
    }): Promise<EvaluationProposal> {
        const spec = validateScoring(task.scoring);
        const unscored = (rationale: string): EvaluationProposal => ({ status: 'unscored', correctness: null, rubricScores: {}, rationale });
        let correct: boolean;
        if (spec.kind === 'open')
            return unscored('Open responses require rubric interpretation by a human or an open-response evaluator.');
        if (spec.kind === 'text')
            correct = normalize(attempt.response, spec.normalization) === normalize(spec.expected, spec.normalization);
        else if (spec.kind === 'choice') {
            if (!spec.options.includes(attempt.response))
                return unscored('Response is not a known option identifier.');
            correct = attempt.response === spec.expected;
        }
        else if (spec.kind === 'numeric') {
            const response = attempt.response.trim();
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(response) || !Number.isFinite(Number(response)))
                return unscored('Expected one finite decimal number; no expressions or partial parsing.');
            correct = Math.abs(Number(response) - spec.expected) <= spec.tolerance;
        }
        else {
            let values: unknown;
            try {
                values = JSON.parse(attempt.response);
            }
            catch {
                return unscored('Expected a JSON array of bounded strings.');
            }
            if (!Array.isArray(values) || values.length > 100 || values.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 200))
                return unscored('Expected a JSON array of bounded strings.');
            const normalized = (values as string[]).map((v) => normalize(v, spec.normalization));
            const actual = new Set(normalized);
            if (spec.duplicates === 'reject' && actual.size !== normalized.length)
                return unscored('Duplicate set members rejected by the task specification.');
            const expected = new Set(spec.expected.map((v) => normalize(v, spec.normalization)));
            correct = actual.size === expected.size && [...actual].every((v) => expected.has(v));
        }
        return { status: 'scored', correctness: correct ? 1 : 0, rubricScores: {}, rationale: `${spec.kind} comparison under the immutable task specification: ${correct ? 'match' : 'mismatch'}. Correctness is not mastery.` };
    }
}
