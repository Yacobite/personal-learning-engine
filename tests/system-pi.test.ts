import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { systemFixture, fillProfile } from './helpers/system-fixtures.ts';
test('full pinned Pi loads all command groups offline; help is lazy and doctor is read-only', async () => {
    const f = await systemFixture();
    const config = mkdtempSync(join(tmpdir(), 'learning m9 pi '));
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    try {
        fillProfile(f);
        const settingsManager = SettingsManager.inMemory();
        const loader = new DefaultResourceLoader({ cwd: f.root, agentDir: config, settingsManager, additionalExtensionPaths: [fileURLToPath(new URL('../.pi/extensions/index.ts', import.meta.url))], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
        await loader.reload();
        assert.deepEqual(loader.getExtensions().errors, []);
        const runtime = await ModelRuntime.create({ authPath: join(config, 'auth.json'), modelsPath: null, modelsStorePath: join(config, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        ({ session } = await createAgentSession({ cwd: f.root, agentDir: config, settingsManager, resourceLoader: loader, modelRuntime: runtime, sessionManager: SessionManager.inMemory(), tools: [] }));
        const messages: string[] = [], errors: unknown[] = [];
        await session.bindExtensions({ mode: 'rpc', uiContext: { ...session.extensionRunner.getUIContext(), notify: m => { messages.push(m); } }, onError: e => { errors.push(e); } });
        for (const name of ['learning-status', 'learning-help', 'learning-doctor', 'course', 'source', 'curriculum', 'attempt', 'evidence', 'diagnostic', 'teach', 'state', 'readiness', 'gaps', 'review'])
            assert(session.extensionRunner.getCommand(name), name);
        await session.prompt('/learning-help');
        assert.match(messages.at(-1)!, /DIAGNOSTIC:.*skip/);
        assert.match(messages.at(-1)!, /AUDIT:.*evidence/);
        assert.deepEqual(JSON.parse(readFileSync(join(config, 'auth.json'), 'utf8')), {});
        await session.prompt('/course use ' + f.course.id);
        for (const command of ['/source list', '/curriculum list', '/evidence recent', '/state', '/readiness', '/gaps', '/review'])
            await session.prompt(command);
        const before = JSON.stringify(f.runtime.store.reviews.list(f.course.id));
        await session.prompt('/learning-doctor');
        assert.match(messages.at(-1)!, /"healthy": true/);
        assert.match(messages.at(-1)!, /"integrity": "ok"/);
        assert.equal(JSON.stringify(f.runtime.store.reviews.list(f.course.id)), before);
        assert.deepEqual(errors, []);
    }
    finally {
        if (session) {
            try {
                await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
                await session.abort();
            }
            finally {
                session.dispose();
            }
        }
        f.close();
        rmSync(config, { recursive: true, force: true });
    }
});
