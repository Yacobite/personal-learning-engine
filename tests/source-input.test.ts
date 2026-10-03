import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { ProjectSourceReader, fetchHtml } from '../src/ingestion/input-reader.ts';
import { SourceError } from '../src/domain/source.ts';

test('explicit source files are read unchanged; traversal, non-source paths, symlink escape and oversize are rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'learning-m2-input-'));
  const outside = mkdtempSync(join(tmpdir(), 'learning-m2-outside-'));
  try {
    mkdirSync(join(root, 'sources', 'inbox'), { recursive: true });
    const path = join(root, 'sources', 'inbox', 'input.txt');
    writeFileSync(path, 'Learner original');
    const digest = () => createHash('sha256').update(readFileSync(path)).digest('hex');
    const before = digest();
    const reader = new ProjectSourceReader(root);
    const result = await reader.read({ location: 'sources/inbox/input.txt' });
    assert.equal(result.kind, 'text');
    assert.equal(result.identityKey, 'sources/inbox/input.txt');
    assert.equal(result.location, 'sources/inbox/input.txt');
    assert.equal(result.requestedLocation, 'sources/inbox/input.txt');
    assert.equal(new TextDecoder().decode(result.bytes), 'Learner original');
    assert.equal(digest(), before);
    assert.equal((await reader.read({ location: path })).identityKey, result.identityKey);
    for (const location of ['../outside.txt', 'package.json', 'sources/../../outside.txt']) {
      await assert.rejects(reader.read({ location }), (e) => e instanceof SourceError && e.code === 'unsafe-path');
    }
    writeFileSync(join(outside, 'secret.txt'), 'Secret');
    symlinkSync(outside, join(root, 'sources', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(reader.read({ location: 'sources/escape/secret.txt' }), /symlinks/);
    writeFileSync(join(root, 'sources', 'inbox', 'unknown.bin'), 'unsupported');
    await assert.rejects(reader.read({ location: 'sources/inbox/unknown.bin' }), (e) => e instanceof SourceError && e.code === 'unsupported');
    writeFileSync(join(root, 'sources', 'inbox', 'huge.txt'), Buffer.alloc(32 * 1024 * 1024 + 1));
    await assert.rejects(reader.read({ location: 'sources/inbox/huge.txt' }), /at most/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
test('local identity and provenance normalize equally across different workspace roots and Windows path casing', async () => {
  const roots = [mkdtempSync(join(tmpdir(), 'learning-m2-identity-a-')), mkdtempSync(join(tmpdir(), 'learning-m2-identity-b-'))];
  try {
    const prepared = [];
    for (const root of roots) {
      mkdirSync(join(root, 'sources', 'inbox'), { recursive: true });
      const path = join(root, 'sources', 'inbox', 'Logic.txt');
      writeFileSync(path, 'P → Q');
      const reader = new ProjectSourceReader(root);
      const relative = await reader.read({ location: 'sources/inbox/Logic.txt' });
      const absolute = await reader.read({ location: path });
      const normalized = await reader.read({ location: 'sources/inbox/../inbox/Logic.txt' });
      assert.equal(relative.identityKey, absolute.identityKey);
      assert.equal(relative.identityKey, normalized.identityKey);
      assert.equal(relative.identityKey, process.platform === 'win32' ? 'sources/inbox/logic.txt' : 'sources/inbox/Logic.txt');
      assert.equal(relative.location, 'sources/inbox/Logic.txt');
      assert.ok(!relative.identityKey.includes(root));
      if (process.platform === 'win32') {
        const casing = await reader.read({ location: 'SOURCES\\INBOX\\LOGIC.TXT' });
        assert.equal(casing.identityKey, relative.identityKey);
      }
      prepared.push(relative);
    }
    assert.equal(prepared[0]!.identityKey, prepared[1]!.identityKey);
    assert.equal(prepared[0]!.location, prepared[1]!.location);
  } finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
});
test('URL preparation keeps final canonical identity and YouTube captions are explicit project-local inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'learning-m2-urls-'));
  try {
    const fetched: string[] = [];
    const reader = new ProjectSourceReader(root, async (url) => { fetched.push(url);
      return { bytes: new TextEncoder().encode('<main>Logic</main>'), finalUrl: 'https://example.test/final#section' }; });
    const web = await reader.read({ location: 'https://example.test/original#fragment' });
    assert.equal(web.identityKey, 'https://example.test/final');
    assert.equal(web.requestedLocation, 'https://example.test/original');
    assert.equal(web.origin, 'learner_url');
    await assert.rejects(reader.read({ location: 'https://user:secret@example.test/' }), /without credentials/);
    await assert.rejects(reader.read({ location: 'file:///secret' }), /HTTP/);
    const video = await reader.read({ location: 'https://youtu.be/abcdefghijk?t=8' });
    assert.equal(video.location, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(video.captionsLocation, undefined);
    assert.deepEqual(fetched, ['https://example.test/original']);
    mkdirSync(join(root, 'sources'), { recursive: true });
    writeFileSync(join(root, 'sources', 'captions.vtt'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nLogic\n');
    const captions = await reader.read({ location: video.location, captionsPath: 'sources/captions.vtt' });
    assert.equal(captions.identityKey, video.identityKey);
    assert.ok(captions.captionsLocation);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('HTTP follows bounded redirects to HTML without cookies/authorization and rejects non-HTML', async () => {
  const requests: { path: string; cookie?: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url!, ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) });
    if (request.url === '/start') { response.writeHead(302, { Location: '/final', 'Set-Cookie': 'secret=ignored' }); response.end(); }
    else if (request.url === '/binary') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end('PDF'); }
    else if (request.url === '/loop') { response.writeHead(302, { Location: '/loop' }); response.end(); }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<main><h1>Logic</h1></main>'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const root = `http://127.0.0.1:${address.port}`;
    const result = await fetchHtml(`${root}/start`);
    assert.equal(result.finalUrl, `${root}/final`);
    assert.match(new TextDecoder().decode(result.bytes), /Logic/);
    assert.deepEqual(requests, [{ path: '/start' }, { path: '/final' }]);
    await assert.rejects(fetchHtml(`${root}/binary`), /HTML/);
    await assert.rejects(fetchHtml(`${root}/loop`), /retrieval failed/);
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
});
