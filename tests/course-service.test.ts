import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CourseError, courseModes } from '../src/domain/course.ts';
import type { Course } from '../src/domain/course.ts';
import type { CourseRepository } from '../src/ports/course-repository.ts';
import { CourseService } from '../src/services/course-service.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';

const firstId = 'course-00000000-0000-4000-8000-000000000001';
const secondId = 'course-00000000-0000-4000-8000-000000000002';
const missingId = 'course-00000000-0000-4000-8000-000000000003';
const input = { title: ' Logic ', mode: 'source_grounded', objective: ' Learn the module ' };
const now = () => new Date('2026-10-03T12:00:00.000Z');

class MemoryCourses implements CourseRepository {
  readonly rows = new Map<string, Course>();
  create(course: Course): void {
    if (this.rows.has(course.id)) throw new CourseError('duplicate-id', 'duplicate');
    this.rows.set(course.id, { ...course });
  }
  getById(id: string): Course | undefined { return this.rows.get(id); }
  list(): Course[] { return [...this.rows.values()]; }
}

test('creates validated courses through a fake port with stable IDs and timestamps', () => {
  const repository = new MemoryCourses();
  const service = new CourseService(repository, () => firstId, now);
  const course = service.createCourse(input);
  assert.deepEqual(course, {
    id: firstId, title: 'Logic', mode: 'source_grounded', objective: 'Learn the module',
    createdAt: now().toISOString(), updatedAt: now().toISOString(),
  });
  assert.deepEqual(service.getCourse(firstId), course);
  assert.deepEqual(service.listCourses(), [course]);
  assert.equal(service.getCourse(firstId).id, firstId);
});

test('supports all course modes and permits duplicate titles with distinct identities', () => {
  const repository = new MemoryCourses();
  let index = 0;
  const service = new CourseService(repository, () => [firstId, secondId, missingId][index++]!, now);
  for (const mode of courseModes) service.createCourse({ ...input, mode });
  assert.equal(service.listCourses().length, 3);
  assert.deepEqual(service.listCourses().map((course) => course.mode), [...courseModes]);
  assert.equal(new Set(service.listCourses().map((course) => course.id)).size, 3);
});

test('rejects empty title/objective, invalid mode and unsafe IDs without writing rows', () => {
  const repository = new MemoryCourses();
  const service = new CourseService(repository, () => firstId, now);
  for (const invalid of [{ ...input, title: ' \t ' }, { ...input, objective: '\n' }, { ...input, mode: 'unknown' }]) {
    assert.throws(() => service.createCourse(invalid), (error) => error instanceof CourseError && error.code === 'invalid-input');
  }
  for (const id of ['', '../outside', 'CON', firstId.toUpperCase(), `${firstId}/file`, 'logic']) {
    assert.throws(() => service.getCourse(id), (error) => error instanceof CourseError && error.code === 'invalid-input');
  }
  assert.throws(() => new CourseService(repository, () => '../unsafe', now).createCourse(input), /Invalid course ID/);
  assert.equal(repository.rows.size, 0);
});

test('returns an empty list and a clear error for a well-formed missing course', () => {
  const service = new CourseService(new MemoryCourses(), () => firstId, now);
  assert.deepEqual(service.listCourses(), []);
  assert.throws(() => service.getCourse(missingId), (error) => error instanceof CourseError && error.code === 'not-found');
});

test('retries ID collisions without overwriting and stops after three failed allocations', () => {
  const repository = new MemoryCourses();
  const service = new CourseService(repository, () => firstId, now);
  const original = service.createCourse(input);
  let calls = 0;
  const retry = new CourseService(repository, () => calls++ === 0 ? firstId : secondId, now);
  assert.equal(retry.createCourse({ ...input, title: 'Python' }).id, secondId);
  assert.equal(calls, 2);
  assert.deepEqual(service.getCourse(firstId), original);
  calls = 0;
  const exhausted = new CourseService(repository, () => { calls++; return firstId; }, now);
  assert.throws(() => exhausted.createCourse(input), (error) => error instanceof CourseError && error.code === 'duplicate-id');
  assert.equal(calls, 3);
  assert.equal(repository.rows.size, 2);
});

test('wraps storage failures with understandable, independently testable errors', () => {
  const cause = new Error('database unavailable');
  const fail = () => { throw cause; };
  const service = new CourseService({ create: fail, getById: fail, list: fail }, () => firstId, now);
  for (const operation of [() => service.createCourse(input), () => service.getCourse(firstId), () => service.listCourses()]) {
    assert.throws(operation, (error) => error instanceof CourseError && error.code === 'storage' && error.cause === cause);
  }
});

test('two sessions select independently; missing selections fail without changing the active course', () => {
  const repository = new MemoryCourses();
  let index = 0;
  const service = new CourseService(repository, () => [firstId, secondId][index++]!, now);
  service.createCourse(input);
  service.createCourse({ ...input, title: 'Python' });
  const first = new CourseSession();
  const second = new CourseSession();
  assert.equal(first.current(service), undefined);
  first.use(firstId, service);
  second.use(secondId, service);
  assert.equal(first.current(service)?.id, firstId);
  assert.equal(second.current(service)?.id, secondId);
  assert.throws(() => first.use(missingId, service), /not found/);
  assert.equal(first.current(service)?.id, firstId);
  first.clear();
  assert.equal(first.current(service), undefined);
  assert.equal(second.current(service)?.id, secondId);
  assert.equal(service.listCourses().length, 2);
});
