import type { DiagnosticTaskContext } from './diagnostic-generator.ts';
import type { ReviewItem } from '../domain/review.ts';
export interface ReviewTaskContext {
    grounding: DiagnosticTaskContext;
    item: Pick<ReviewItem, 'dimension' | 'type' | 'representation' | 'novelty'>;
    /** Hashes, never previous answers or scoring keys. */
    previousPromptHashes: string[];
}
export interface ReviewTaskGenerator {
    propose(context: ReviewTaskContext): Promise<unknown>;
}
