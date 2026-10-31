import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { obsidianFixture, dbRows, fakeStudy } from './helpers/obsidian-fixtures.ts';
import { registerObsidian } from '../src/runtime/pi/register-obsidian.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
test('actual Pi registers /obsidian and runs init/sync/status/path offline with active-course boundaries', async () => {
    const f = await obsidianFixture(), config = mkdtempSync(join(tmpdir(), 'obsidian pi '));
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    try {
        const settingsManager = SettingsManager.inMemory(), loader = new DefaultResourceLoader({ cwd: f.root, agentDir: config, settingsManager, additionalExtensionPaths: [fileURLToPath(new URL('../.pi/extensions/index.ts', import.meta.url))], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
        await loader.reload();
        assert.deepEqual(loader.getExtensions().errors, []);
        const runtime = await ModelRuntime.create({ authPath: join(config, 'auth.json'), modelsPath: null, modelsStorePath: join(config, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        ({ session } = await createAgentSession({ cwd: f.root, agentDir: config, settingsManager, resourceLoader: loader, modelRuntime: runtime, sessionManager: SessionManager.inMemory(), tools: [] }));
        const messages: string[] = [], errors: unknown[] = [];
        await session.bindExtensions({ mode: 'rpc', uiContext: { ...session.extensionRunner.getUIContext(), notify: m => { messages.push(m); } }, onError: e => { errors.push(e); } });
        assert(session.extensionRunner.getCommand('obsidian'));
        const before = dbRows(f.root);
        await session.prompt('/obsidian init');
        await session.prompt('/obsidian path');
        assert.match(messages.at(-1)!, /Open this folder as a vault/);
        await session.prompt('/obsidian sync');
        assert.match(messages.at(-1)!, /Select a course/);
        await session.prompt('/course use ' + f.course.id);
        await session.prompt('/obsidian sync');
        assert.match(messages.at(-1)!, /SQLite remains canonical/);
        await session.prompt('/obsidian status');
        assert.match(messages.at(-1)!, /"conceptNotes": 1/);
        assert.deepEqual(JSON.parse(readFileSync(join(config, 'auth.json'), 'utf8')), {});
        assert.equal(session.messages.length, 0);
        assert.equal(dbRows(f.root), before);
        assert.deepEqual(errors, []);
    }
    finally {
        if (session) {
            await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
            session.dispose();
        }
        f.close();
        rmSync(config, { recursive: true, force: true });
    }
});
test('Pi enrichment delegates through the injected proposal port while no-model and invalid syntax errors stay clear', async () => {
    const f = await obsidianFixture();
    try {
        const handlers = new Map<string, Parameters<ExtensionAPI['registerCommand']>[1]>(), messages: string[] = [], selection = new CourseSession();
        selection.use(f.course.id, f.runtime.courses);
        let calls = 0;
        registerObsidian({ registerCommand: (n, c) => { assert(!handlers.has(n)); handlers.set(n, c); } }, () => ({ exports: f.exports, courses: f.runtime.courses, selection }), () => ({ propose: async (c) => { calls++; return fakeStudy.propose(c); } }));
        const ctx = { cwd: f.root, model: undefined, ui: { notify: (m: string) => messages.push(m) } } as unknown as ExtensionCommandContext;
        await handlers.get('obsidian')!.handler('enrich all', ctx);
        assert.match(messages.at(-1)!, /No model configured/);
        assert.equal(calls, 0);
        await handlers.get('obsidian')!.handler('nonsense', ctx);
        assert.match(messages.at(-1)!, /Usage:/);
        await handlers.get('obsidian')!.handler('enrich all', { ...ctx, model: { id: 'synthetic-model' } } as ExtensionCommandContext);
        assert.equal(calls, 1);
        assert.match(messages.at(-1)!, /"updated"/);
    }
    finally {
        f.close();
    }
});
