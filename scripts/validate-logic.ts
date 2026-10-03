/** Local acceptance only: private PDFs and results remain beneath ignored _learning/. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { openLearningDatabase } from '../src/persistence/database.ts';

const project = resolve(process.cwd());
const names = ['topic0.pdf', 'topic1.pdf', 'topic2.pdf'];
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const originals = names.map((name) => ({ name, path: join(project, 'sources', 'inbox', name), hash: hash(join(project, 'sources', 'inbox', name)) }));
const directory = join(project, '_learning', 'm2-acceptance');
mkdirSync(directory, { recursive: true });
const workspace = mkdtempSync(join(directory, 'run-'));
mkdirSync(join(workspace, 'sources', 'inbox'), { recursive: true });
for (const original of originals) copyFileSync(original.path, join(workspace, 'sources', 'inbox', original.name));
const agentDir = join(workspace, 'pi-config');
const settingsManager = SettingsManager.inMemory();
const loader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager,
  additionalExtensionPaths: [fileURLToPath(new URL('../.pi/extensions/index.ts', import.meta.url))],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null,
  modelsStorePath: join(agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
const { session } = await createAgentSession({ cwd: workspace, agentDir, settingsManager, resourceLoader: loader,
  modelRuntime, sessionManager: SessionManager.inMemory(), tools: [] });
const messages: string[] = [];
const errors: unknown[] = [];
const commands: { command: string; output: string }[] = [];
await session.bindExtensions({ mode: 'rpc', uiContext: { ...session.extensionRunner.getUIContext(),
  notify: (message) => { messages.push(message); } }, onError: (error) => { errors.push(error); } });
async function command(value: string): Promise<string> {
  await session.prompt(value);
  const output = messages.at(-1) ?? '';
  commands.push({ command: value, output });
  return output;
}
try {
  const created = await command('/course new source_grounded "Logic M2 acceptance" "Inspect real course sources"');
  const courseId = created.match(/course-[0-9a-f-]{36}/)?.[0];
  assert.ok(courseId, created);
  await command(`/course use ${courseId}`);
  for (const name of names) {
    const output = await command(`/source add sources/inbox/${name}`);
    assert.match(output, /^Ingested /);
    assert.doesNotMatch(output, /; failed;/);
  }
  await command('/source list');
  let store = openLearningDatabase(workspace);
  const sources = store.sources.list(courseId);
  assert.equal(sources.length, 3);
  const documents = sources.map((source) => {
    const version = store.sources.getVersion(courseId, source.id, source.currentVersion)!;
    return { source, pageCount: version.metadata.pageCount, segmentCount: version.segments.length,
      warnings: version.warnings, hash: version.contentHash, text: version.segments.map((s) => s.text).join('\n') };
  });
  const candidates = ['implication', 'proposition', 'truth', 'formula', 'natural', 'deduction', 'equivalence', 'logic', 'semantics', 'syntax'];
  const terms = candidates.filter((term) => documents.some((d) => new RegExp(`\\b${term}\\b`, 'i').test(d.text))).slice(0, 5);
  assert.ok(terms.length >= 3, 'Need several observed terms, not fabricated search expectations.');
  const searches = [];
  for (const term of terms) {
    const results = store.sources.search(courseId, `"${term}"`, 5);
    assert.ok(results.length, term);
    searches.push({ term, results: results.map((r) => ({ title: r.source.title, sourceId: r.source.id,
      version: r.segment.version, anchor: r.segment.anchor, rank: r.rank })) });
    await command(`/source search "${term}"`);
  }
  store.close();
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'new' });
  await session.extensionRunner.emit({ type: 'session_start', reason: 'new' });
  assert.match(await command('/source list'), /^No active course/);
  await command(`/course use ${courseId}`);
  assert.match(await command('/source list'), new RegExp(sources[0]!.id));
  assert.match(await command('/source add sources/inbox/topic0.pdf'), /^Unchanged .* v1/);
  const fixture = join(workspace, 'sources', 'inbox', 'version-demo.txt');
  writeFileSync(fixture, 'Controlled fixture: implication in version one.');
  const first = await command('/source add sources/inbox/version-demo.txt');
  const fixtureId = first.match(/source-[0-9a-f-]{36}/)?.[0];
  assert.ok(fixtureId, first);
  writeFileSync(fixture, 'Controlled fixture: equivalence in version two.');
  assert.match(await command('/source add sources/inbox/version-demo.txt'), /^Ingested .* v2/);
  await command(`/source status ${fixtureId} 1`);
  await command(`/source status ${fixtureId} 2`);
  store = openLearningDatabase(workspace);
  try {
    assert.match(store.sources.getVersion(courseId, fixtureId, 1)!.segments[0]!.text, /implication/);
    assert.match(store.sources.getVersion(courseId, fixtureId, 2)!.segments[0]!.text, /equivalence/);
    assert.equal(store.sources.getVersion(courseId, sources[0]!.id, 2), undefined);
  } finally { store.close(); }
  for (const original of originals) assert.equal(hash(original.path), original.hash, 'Learner original changed');
  assert.deepEqual(errors, []);
  assert.equal(session.messages.length, 0, 'No model conversation or credentials used.');
  const report = { workspace, courseId, documents: documents.map(({ text: _privateText, ...document }) => document),
    searches, restartPersistence: true, unchangedVersion: 1, controlledFixtureVersions: [1, 2], originalsUnchanged: true, commands };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, commands: commands.filter((c) => !c.command.startsWith('/source search')) }, null, 2));
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}
