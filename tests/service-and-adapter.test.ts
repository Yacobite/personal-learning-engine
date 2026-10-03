import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { FoundationService } from '../src/services/foundation-service.ts';
import { registerLearningStatus } from '../src/runtime/pi/register-status.ts';

test('application service operates with an independent store and no Pi runtime', () => {
  const expected = { schemaVersion: 7, sqliteVersion: 'test-driver', fts5Available: false };
  let calls = 0;
  const service = new FoundationService({ readStatus: () => { calls++; return expected; } });
  assert.deepEqual(service.getStatus(), expected);
  assert.equal(calls, 1);
});

test('Pi command delegates to the supplied application service', async () => {
  let handler: Parameters<ExtensionAPI['registerCommand']>[1]['handler'] | undefined;
  let calls = 0;
  const messages: string[] = [];
  registerLearningStatus({ registerCommand: (name, options) => {
    assert.equal(name, 'learning-status');
    handler = options.handler;
  } }, () => ({ getStatus: () => {
    calls++;
    return { schemaVersion: 9, sqliteVersion: 'adapter-fixture', fts5Available: false };
  } }));
  assert.equal(calls, 0, 'registration must not call the service');
  assert.ok(handler);
  await handler('', { ui: { notify: (message: string) => { messages.push(message); } } } as unknown as ExtensionCommandContext);
  assert.equal(calls, 1);
  assert.deepEqual(messages, ['Learning foundation: schema v9; SQLite adapter-fixture; FTS5 unavailable.']);
});
