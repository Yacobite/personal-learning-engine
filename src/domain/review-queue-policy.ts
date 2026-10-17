import { reviewLimit, temporalStatus } from './review.ts';
import type { ReviewItem } from './review.ts';
/** Future orchestration may pass a deadline; it never relaxes eligibility or priority classes. */
export interface ReviewDeadlineContext {
    deadlineAt: string;
}
export function reviewQueue(items: readonly ReviewItem[], now: string, limit = 10, context?: ReviewDeadlineContext): ReviewItem[] {
    reviewLimit(limit);
    if (context)
        temporalStatus({ earliestAt: context.deadlineAt, dueAt: context.deadlineAt }, now);
    const recent = items.filter(i => i.status === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id.localeCompare(a.id))[0];
    const rank = (i: ReviewItem) => ({ gap_verification: 0, delayed_verification: 2, maintenance: 4 }[i.kind]) + (temporalStatus(i, now) === 'overdue' ? 0 : 1);
    const variety = (i: ReviewItem) => recent ? [i.conceptId === recent.conceptId, i.dimension === recent.dimension, i.type === recent.type, i.representation === recent.representation].map(Number) : [0, 0, 0, 0];
    return items.filter(i => i.status === 'scheduled' && temporalStatus(i, now) !== 'upcoming').sort((a, b) => {
        const av = variety(a), bv = variety(b);
        return rank(a) - rank(b) || a.dueAt.localeCompare(b.dueAt) || av[0]! - bv[0]! || av[1]! - bv[1]! || av[2]! - bv[2]! || av[3]! - bv[3]!
            || a.conceptId.localeCompare(b.conceptId) || a.id.localeCompare(b.id);
    }).slice(0, limit);
}
