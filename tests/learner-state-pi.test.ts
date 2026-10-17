import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { registerLearnerState } from '../src/runtime/pi/register-learner-state.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
import { learnerFixture } from './helpers/learner-state-fixtures.ts';
test('state/readiness/gap commands are course-scoped, credential-free and expose audits without arbitrary writes', async () => {
    const f = learnerFixture();
    try {
        const selection = new CourseSession();
        const handlers = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>();
        const messages: string[] = [];
        const pi: Pick<ExtensionAPI, 'registerCommand'> = { registerCommand: (name, command) => { handlers.set(name, command.handler); } };
        const ctx = { cwd: '.', ui: { notify: (s: string) => messages.push(s) } } as unknown as ExtensionCommandContext;
        registerLearnerState(pi, () => ({ courses: f.courses, selection, state: f.state, readiness: f.readiness, gaps: f.gaps }));
        assert.deepEqual([...handlers.keys()], ['state', 'readiness', 'gaps']);
        await handlers.get('state')!('', ctx);
        assert.match(messages.at(-1)!, /Select a course/);
        selection.use(f.courseId, f.courses);
        f.add({ correctness: 0 });
        await handlers.get('state')!('', ctx);
        assert.match(messages.at(-1)!, /independent_support/);
        const r = f.state.current(f.courseId)!;
        await handlers.get('state')!('concept ' + f.root, ctx);
        assert.match(messages.at(-1)!, /independent_difficulty/);
        assert(!messages.at(-1)!.includes('SYNTHETIC_RESPONSE_SENTINEL'));
        await handlers.get('state')!('revision ' + r.id, ctx);
        assert.match(messages.at(-1)!, /evidence-state-v1/);
        await handlers.get('state')!('history', ctx);
        await handlers.get('readiness')!('', ctx);
        assert.match(messages.at(-1)!, /curriculumVersion/);
        await handlers.get('readiness')!('concept ' + f.root, ctx);
        assert.match(messages.at(-1)!, /missingDurable/);
        await handlers.get('gaps')!('', ctx);
        assert.match(messages.at(-1)!, /OPEN/);
        await handlers.get('gaps')!('show ' + r.gaps[0]!.id, ctx);
        assert.match(messages.at(-1)!, /performance_failure/);
        await handlers.get('gaps')!('all', ctx);
        const revisions = f.state.history(f.courseId).length;
        await handlers.get('state')!('mark-mastered ' + f.root, ctx);
        assert.match(messages.at(-1)!, /Usage/);
        await handlers.get('gaps')!('close ' + r.gaps[0]!.id, ctx);
        assert.match(messages.at(-1)!, /Usage/);
        assert.equal(f.state.history(f.courseId).length, revisions);
    }
    finally {
        f.store.close();
    }
});
