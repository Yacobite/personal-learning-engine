import type { Course } from '../domain/course.ts';

export interface CourseRepository {
  create(course: Course): void;
  getById(id: string): Course | undefined;
  list(): Course[];
}
