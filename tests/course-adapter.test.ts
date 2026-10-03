import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { CourseError } from '../src/domain/course.ts';
import type { Course } from '../src/domain/course.ts';
import { CourseSession } from '../src/runtime/pi/course-session.ts';
import { registerCourse } from '../src/runtime/pi/register-course.ts';

const id = 'course-00000000-0000-4000-8000-000000000001';
const course: Course = {
  id, title: 'Logic', mode: 'source_grounded', objective: 'Understand logic',
  createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z',
};

test('course adapter parses quoted input, delegates all operations and presents session selection', async () => {
  let handler: Parameters<ExtensionAPI['registerCommand']>[1]['handler'] | undefined;
  const calls: unknown[] = [];
  const messages: string[] = [];
  const selection = new CourseSession();
  registerCourse({ registerCommand: (name, options) => {
    assert.equal(name, 'course'); handler = options.handler;
  } }, () => ({ selection, service: {
    createCourse: (input) => { calls.push(input); return course; },
    listCourses: () => { calls.push('list'); return [course]; },
    getCourse: (requested) => { calls.push(requested); return course; },
  } }));
  assert.ok(handler);
  const ctx = { ui: { notify: (text: string) => { messages.push(text); } } } as unknown as ExtensionCommandContext;
  await handler('new source_grounded "Logic with \\"quotes\\"" "Understand logic"', ctx);
  assert.deepEqual(calls[0], { mode: 'source_grounded', title: 'Logic with "quotes"', objective: 'Understand logic' });
  await handler('list', ctx);
  await handler(`use ${id}`, ctx);
  await handler('current', ctx);
  assert.deepEqual(calls.slice(1), ['list', id, id]);
  assert.match(messages[3] ?? '', /Current course/);
});

test('course adapter handles malformed commands and reports application errors without exposing internals', async () => {
  let handler: Parameters<ExtensionAPI['registerCommand']>[1]['handler'] | undefined;
  const messages: string[] = [];
  let creates = 0;
  registerCourse({ registerCommand: (_name, options) => { handler = options.handler; } }, () => ({
    selection: new CourseSession(), service: {
      createCourse: () => { creates++; throw new CourseError('invalid-input', 'Course title cannot be empty.'); },
      listCourses: () => { throw new Error('SECRET internal path'); },
      getCourse: () => { throw new CourseError('not-found', 'Course was not found.'); },
    },
  }));
  assert.ok(handler);
  const ctx = { ui: { notify: (text: string) => { messages.push(text); } } } as unknown as ExtensionCommandContext;
  for (const args of ['new', 'new hybrid "unterminated', 'new hybrid "a""b" "c"', 'use', 'current extra', 'unknown']) {
    await handler(args, ctx);
    assert.match(messages.at(-1) ?? '', /^Usage:/);
  }
  assert.equal(creates, 0);
  await handler('new hybrid "" "goal"', ctx);
  assert.equal(messages.at(-1), 'Course title cannot be empty.');
  await handler(`use ${id}`, ctx);
  assert.equal(messages.at(-1), 'Course was not found.');
  await handler('list', ctx);
  assert.doesNotMatch(messages.at(-1) ?? '', /SECRET/);
  assert.match(messages.at(-1) ?? '', /failed/);
});
