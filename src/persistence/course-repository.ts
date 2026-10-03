import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { CourseError, isCourseMode } from '../domain/course.ts';
import type { Course } from '../domain/course.ts';
import type { CourseRepository } from '../ports/course-repository.ts';

function mapCourse(row: Record<string, SQLOutputValue>): Course {
  if (typeof row.id !== 'string' || typeof row.title !== 'string'
    || typeof row.mode !== 'string' || !isCourseMode(row.mode)
    || typeof row.objective !== 'string' || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string') {
    throw new Error('Invalid persisted course row.');
  }
  return {
    id: row.id, title: row.title, mode: row.mode, objective: row.objective,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class SqliteCourseRepository implements CourseRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  create(course: Course): void {
    try {
      this.database.prepare(
        'INSERT INTO courses (id, title, mode, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(course.id, course.title, course.mode, course.objective, course.createdAt, course.updatedAt);
    } catch (error) {
      if (error instanceof Error && 'errcode' in error && (error.errcode === 1555 || error.errcode === 2067)) {
        throw new CourseError('duplicate-id', 'Course ID already exists.', { cause: error });
      }
      throw error;
    }
  }

  getById(id: string): Course | undefined {
    const row = this.database.prepare(
      'SELECT id, title, mode, objective, created_at, updated_at FROM courses WHERE id = ?',
    ).get(id);
    return row ? mapCourse(row) : undefined;
  }

  list(): Course[] {
    return this.database.prepare(
      'SELECT id, title, mode, objective, created_at, updated_at FROM courses ORDER BY created_at, id',
    ).all().map(mapCourse);
  }
}
