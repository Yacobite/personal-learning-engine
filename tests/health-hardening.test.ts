import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { reviewFixture } from './helpers/review-fixtures.ts';
import { HealthService } from '../src/services/health-service.ts';
import { checkDatabaseCapabilities, validateMigrationHistory } from '../src/persistence/database-health.ts';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { migrations, applyMigrations } from '../src/persistence/migrations.ts';
import { commandSurface, commandOutputLimit } from '../src/runtime/pi/command-surface.ts';
import { registerHealth, learningHelp } from '../src/runtime/pi/register-health.ts';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
test('doctor performs integrity/FK checks and reports resumable metadata without changing any canonical table', () => {
    const f = reviewFixture();
    try {
        f.support();
        const tables = f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name));
        const snapshot = () => JSON.stringify(tables.map(t => f.db.prepare('SELECT * FROM "' + t.replaceAll('"', '""') + '"').all()));
        const before = snapshot();
        const service = new HealthService(f.store.health, '24.19.0');
        const health = service.inspect(f.courseId);
        assert.equal(health.healthy, true);
        assert.equal(health.database.integrity, 'ok');
        assert.equal(health.database.foreignKeyViolations, 0);
        assert.equal(health.database.schemaVersion, 9);
        assert.equal(health.database.course!.activeCurriculum, 1);
        assert(health.database.course!.stateRevisionId);
        assert.equal(health.database.course!.pendingReviews, 1);
        assert.doesNotMatch(JSON.stringify(health), /SYNTHETIC_RESPONSE_SENTINEL|"scoring"|"expected"|sourceRefs/);
        assert.equal(snapshot(), before);
        assert.equal(new HealthService(f.store.health, '25.0.0').inspect().healthy, false);
    }
    finally {
        f.store.close();
    }
});
test('doctor detects FK violations and disabled enforcement without leaking orphan identifiers or deleting data', () => {
    const f = reviewFixture();
    try {
        f.db.exec("PRAGMA foreign_keys=OFF; INSERT INTO course_curriculum_current VALUES ('PRIVATE_ORPHAN_SENTINEL',999); PRAGMA foreign_keys=ON;");
        const r = new HealthService(f.store.health, '24.19.0').inspect();
        assert.equal(r.healthy, false);
        assert.equal(r.database.foreignKeyViolations, 1);
        assert(!JSON.stringify(r).includes('PRIVATE_ORPHAN_SENTINEL'));
        assert.equal(f.db.prepare("SELECT count(*) n FROM course_curriculum_current WHERE course_id='PRIVATE_ORPHAN_SENTINEL'").get()!.n, 1);
        f.db.exec('PRAGMA foreign_keys=OFF');
        assert.throws(() => checkDatabaseCapabilities(f.db), /foreign keys/);
    }
    finally {
        f.store.close();
    }
});
test('all nine historical migration checksums are fixed; unknown future schema and changed history are refused', () => {
    const expected = ['7f4effbc7084f5e36165e0e1dcfa0211b38dabb3c9cf31096af50748a27309d5', '323a20a932860ca7827e4a3ee4c68bcf5d331ec69f4dc30fdcad0debdcb24c51', 'a188de8d7b6fe53da2a5439af26573939c1ea3e1290ed38feaf2ff4edcbe713b', '9a969dbf99bf2344ca017d449a1fd75ed3161b67a841fc3cfda07ad48a6ff157', '9e33f4404ce12a2ce754e6bc41e51097ef820772a4a1141420810dda140cda3e', '77cace496e202fb7ead5fd451e46cf89092efc9e4919b1e4dbb8c21da5cffd22', '667e956729f5eea4a1da52334b88e4ea4d9e2c3540dd99d30ff1126c036de244', 'a788525a2566f16fdcf8bb9f907f79e92217ae8100fd5397d6b25b144278ebb9', '8a494fed1c0f3d8748ef8a9a1e30aeabc34053ca9ad81e7eb6fc6de9d94ce65b'];
    assert.equal(migrations.length, 9);
    assert.deepEqual(migrations.map(m => createHash('sha256').update(JSON.stringify([m.version, m.name, m.sql])).digest('hex')), expected);
    const root = mkdtempSync(join(tmpdir(), 'learning m9 future '));
    try {
        const store = openLearningDatabase(root);
        store.close();
        const path = join(root, '_learning', 'learning.db');
        const db = new DatabaseSync(path);
        db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(10, 'SYNTHETIC_FUTURE_SCHEMA', 'unknown', '2040-01-01T00:00:00.000Z');
        db.close();
        assert.throws(() => openLearningDatabase(root), /newer than this engine/);
        const verify = new DatabaseSync(path);
        assert.equal(verify.prepare('SELECT max(version) n FROM schema_migrations').get()!.n, 10);
        verify.close();
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('light startup validation accepts pending history; failed migrations preserve prior ledger and audit', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('PRAGMA foreign_keys=ON');
        applyMigrations(db, migrations.slice(0, 1));
        assert.equal(validateMigrationHistory(db, false), 1);
        assert.throws(() => validateMigrationHistory(db), /incomplete/);
        const before = db.prepare('SELECT * FROM schema_migrations').all();
        assert.throws(() => applyMigrations(db, [migrations[0]!, { version: 2, name: 'SYNTHETIC_FAILURE', sql: 'CREATE TABLE transient_fixture(id INTEGER); INVALID SQL;' }]));
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), before);
        assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='transient_fixture'").get(), undefined);
        db.prepare("UPDATE schema_migrations SET checksum='bad' WHERE version=1").run();
        assert.throws(() => validateMigrationHistory(db, false), /Invalid migration history/);
    }
    finally {
        db.close();
    }
});
test('canonical database path rejects an internal junction as well as a reparse point at the database path', () => {
    const root = mkdtempSync(join(tmpdir(), 'learning m9 paths '));
    try {
        mkdirSync(join(root, 'code'));
        symlinkSync(join(root, 'code'), join(root, '_learning'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => openLearningDatabase(root), /symbolic link/);
        assert(!existsSync(join(root, 'code', 'learning.db')));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
    const other = mkdtempSync(join(tmpdir(), 'learning m9 filelink '));
    try {
        mkdirSync(join(other, '_learning'));
        const target = join(other, 'target');
        mkdirSync(target);
        symlinkSync(target, join(other, '_learning', 'learning.db'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => openLearningDatabase(other), /symbolic link/);
    }
    finally {
        rmSync(other, { recursive: true, force: true });
    }
});
test('help/doctor register once, expose actual groups, bound notifications and do not intercept normal chat', async () => {
    const f = reviewFixture();
    try {
        const handlers = new Map<string, Parameters<ExtensionAPI['registerCommand']>[1]>(), messages: string[] = [];
        const api: Pick<ExtensionAPI, 'registerCommand'> = { registerCommand: (name, command) => { assert(!handlers.has(name)); handlers.set(name, command); } };
        const surface = commandSurface(api);
        registerHealth(surface, () => ({ health: new HealthService(f.store.health, '24.19.0'), activeCourseId: f.courseId }));
        assert.deepEqual([...handlers.keys()], ['learning-help', 'learning-doctor']);
        const ctx = { ui: { notify: (s: string) => messages.push(s) } } as unknown as ExtensionCommandContext;
        await handlers.get('learning-help')!.handler('', ctx);
        assert.equal(messages.at(-1), learningHelp);
        await handlers.get('learning-doctor')!.handler('', ctx);
        assert.match(messages.at(-1)!, /"healthy": true/);
        assert.match(messages.at(-1)!, /"integrity": "ok"/);
        assert.throws(() => surface.registerCommand('learning-help', { description: 'duplicate', handler: async () => { } }), /Duplicate/);
        surface.registerCommand('synthetic-large', { description: 'synthetic fixture', handler: async (_args, c) => c.ui.notify('x'.repeat(commandOutputLimit * 2)) });
        await handlers.get('synthetic-large')!.handler('', ctx);
        assert(messages.at(-1)!.length < commandOutputLimit + 200);
        assert.match(messages.at(-1)!, /Display bounded/);
    }
    finally {
        f.store.close();
    }
});
