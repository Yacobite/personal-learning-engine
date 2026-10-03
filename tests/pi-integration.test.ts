import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

test('pinned Pi loads the real extension and executes the command without a model or credentials', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'learning-m0-pi-'));
  const agentDir = join(workspace, 'isolated-pi-config');
  const extensionPath = fileURLToPath(new URL('../.pi/extensions/index.ts', import.meta.url));
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.equal(loader.getExtensions().extensions.length, 1);
    assert.equal(existsSync(join(workspace, '_learning')), false, 'factory must not open a database');
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(agentDir, 'models-cache.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    ({ session } = await createAgentSession({
      cwd: workspace,
      agentDir,
      settingsManager,
      resourceLoader: loader,
      modelRuntime,
      sessionManager: SessionManager.inMemory(),
      tools: [],
    }));
    const errors: unknown[] = [];
    const messages: string[] = [];
    await session.bindExtensions({
      mode: 'rpc',
      uiContext: {
        ...session.extensionRunner.getUIContext(),
        notify: (message) => { messages.push(message); },
      },
      onError: (error) => { errors.push(error); },
    });
    assert.ok(session.extensionRunner.getCommand('learning-status'));
    await session.prompt('/learning-status');
    assert.deepEqual(errors, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? '', /^Learning foundation: schema v1; SQLite /);
    assert.ok(existsSync(join(workspace, '_learning', 'learning.db')));
    assert.equal(session.messages.length, 0, 'diagnostics must not initiate a model conversation');
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});
