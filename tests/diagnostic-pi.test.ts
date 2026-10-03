import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { registerDiagnostic } from '../src/runtime/pi/register-diagnostic.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
import { fixture } from './helpers/assessment-fixtures.ts';
import { diagnostics, syntheticGenerator } from './helpers/diagnostic-fixtures.ts';
test('Pi diagnostic command delegates fake generation, accepts JSON with spaces/symbols, and keeps answer keys out of feedback', async () => {
    const f = fixture();
    try {
        const d = diagnostics(f);
        const selection = new CourseSession();
        const messages: string[] = [];
        let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
        const pi: Pick<ExtensionAPI, 'registerCommand'> = { registerCommand: (name, command) => { assert.equal(name, 'diagnostic'); handler = command.handler; } };
        const ctx = { cwd: '.', ui: { notify: (s: string) => messages.push(s) } } as unknown as ExtensionCommandContext;
        registerDiagnostic(pi, () => ({ courses: f.courses, selection, diagnostics: d, assessments: f.assessments }), () => syntheticGenerator);
        await handler!('status', ctx);
        assert.match(messages.at(-1)!, /Select a course/);
        selection.use(f.courseId, f.courses);
        await handler!('start 1', ctx);
        const session = d.current(f.courseId)!;
        await handler!('next', ctx);
        assert.doesNotMatch(messages.at(-1)!, /alpha|scoring|expected/);
        const p = d.probes(f.courseId, session.id)[0]!;
        await handler!(`submit ${p.id} ${JSON.stringify({ response: 'P → Q\nsecond line with spaces', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } })}`, ctx);
        assert.doesNotMatch(messages.at(-1)!, /correctness|expected|alpha|independent_incorrect/);
        assert.equal(f.assessments.attempt(f.courseId, d.probes(f.courseId, session.id)[0]!.attemptId!).response, 'P → Q\nsecond line with spaces');
        await handler!(`audit ${session.id}`, ctx);
        assert.match(messages.at(-1)!, /evaluationId/);
        await handler!('next', ctx);
        assert.equal(d.get(f.courseId, session.id).status, 'completed');
        await handler!(`summary ${session.id}`, ctx);
        assert.match(messages.at(-1)!, /provisionally_unsupported/);
        await handler!('history', ctx);
        assert.match(messages.at(-1)!, new RegExp(session.id));
    }
    finally {
        f.store.close();
    }
});
