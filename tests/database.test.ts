import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { applyMigrations, migrations } from '../src/persistence/migrations.ts';

test('initializes the canonical database and survives reopening without reapplying migrations', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'learning-m0-db-'));
  try {
    const store = openLearningDatabase(workspace);
    assert.equal(store.readStatus().schemaVersion, 1);
    assert.match(store.readStatus().sqliteVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(typeof store.readStatus().fts5Available, 'boolean');
    store.close();
    store.close();
    const path = join(workspace, '_learning', 'learning.db');
    assert.ok(existsSync(path));
    const before = new DatabaseSync(path);
    const originalLedger = before.prepare('SELECT * FROM schema_migrations').all();
    assert.equal(originalLedger.length, 1);
    assert.deepEqual(before.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => row.name), ['schema_migrations']);
    before.close();

    const reopened = openLearningDatabase(workspace);
    assert.equal(reopened.readStatus().schemaVersion, 1);
    reopened.close();
    const after = new DatabaseSync(path);
    assert.deepEqual(after.prepare('SELECT * FROM schema_migrations').all(), originalLedger);
    after.close();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('applies a pending migration once and rolls back failed migration SQL and ledger writes', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applyMigrations(database);
    const next = [...migrations, {
      version: 2, name: 'test-fixture', sql: 'CREATE TABLE test_fixture (id INTEGER PRIMARY KEY);',
    }];
    applyMigrations(database, next);
    applyMigrations(database, next);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count, 2);
    assert.throws(() => applyMigrations(database, [...next, {
      version: 3,
      name: 'test-failure',
      sql: 'CREATE TABLE rollback_fixture (id INTEGER); INVALID SQL;',
    }]));
    assert.equal(database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'rollback_fixture'",
    ).get(), undefined);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count, 2);
  } finally {
    database.close();
  }
});

test('rejects changed migrations, unknown schema history, and nonconsecutive definitions', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applyMigrations(database);
    assert.throws(() => applyMigrations(database, [{ version: 1, name: 'changed', sql: '' }]), /history/);
    assert.throws(() => applyMigrations(database, [{ version: 2, name: 'gap', sql: '' }]), /consecutive/);
    database.prepare(
      'INSERT INTO schema_migrations VALUES (?, ?, ?, ?)',
    ).run(2, 'future', 'unknown', new Date().toISOString());
    assert.throws(() => applyMigrations(database), /history/);
  } finally {
    database.close();
  }
});

test('rejects a database directory redirected outside the workspace', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'learning-m0-path-'));
  const outside = mkdtempSync(join(tmpdir(), 'learning-m0-outside-'));
  try {
    symlinkSync(outside, join(workspace, '_learning'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => openLearningDatabase(workspace), /inside the workspace/);
    assert.equal(existsSync(join(outside, 'learning.db')), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
