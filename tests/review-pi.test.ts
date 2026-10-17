import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { registerReview } from '../src/runtime/pi/register-review.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
import { reviewFixture } from './helpers/review-fixtures.ts';
test('review Pi commands preserve rich JSON answers, hide keys, bound history and delegate course-scoped operations', async () => {
    const f = reviewFixture();
    try {
        const selection = new CourseSession(), handlers = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>(), messages: string[] = [];
        const pi: Pick<ExtensionAPI, 'registerCommand'> = { registerCommand: (name, command) => { handlers.set(name, command.handler); } };
        const ctx = { cwd: '.', ui: { notify: (s: string) => messages.push(s) } } as unknown as ExtensionCommandContext;
        registerReview(pi, () => ({ courses: f.courses, selection, reviews: f.reviews, assessments: f.assessments }), () => f.generator);
        const command = handlers.get('review')!;
        await command('', ctx);
        assert.match(messages.at(-1)!, /Select a course/);
        selection.use(f.courseId, f.courses);
        f.support();
        await command('', ctx);
        assert.match(messages.at(-1)!, /upcoming/);
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        await command('next', ctx);
        assert.doesNotMatch(messages.at(-1)!, /"scoring"|"expected"|SYNTHETIC_RESPONSE_SENTINEL/);
        const active = f.reviews.queue(f.courseId).active!;
        assert(active);
        const rich = 'alpha\ncode → β with spaces';
        await command('answer ' + active.id + ' ' + JSON.stringify({ response: rich }), ctx);
        const item = f.reviews.get(f.courseId, active.id);
        assert.equal(f.assessments.attempt(f.courseId, item.attemptId!).response, rich);
        assert(!messages.at(-1)!.includes(rich));
        for (const args of ['status', 'history', 'show ' + active.id]) {
            await command(args, ctx);
            assert.match(messages.at(-1)!, /REVIEW/);
        }
        await command('history 51', ctx);
        assert.match(messages.at(-1)!, /1–50/);
        await command('hint', ctx);
        assert.match(messages.at(-1)!, /Hints\/repair belong to \/teach/);
        const count = f.db.prepare('SELECT count(*) n FROM evidence_events').get()!.n;
        await command('I reviewed this myself', ctx);
        assert.match(messages.at(-1)!, /Usage/);
        assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_events').get()!.n, count);
    }
    finally {
        f.store.close();
    }
});
