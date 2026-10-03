import { CourseError, isCourseId, isCourseMode } from '../domain/course.ts';
import type { Course } from '../domain/course.ts';
import type { CourseRepository } from '../ports/course-repository.ts';

export interface CreateCourseInput {
  readonly title: string;
  readonly mode: string;
  readonly objective: string;
}

export class CourseService {
  private readonly repository: CourseRepository;
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(repository: CourseRepository, generateId: () => string, now: () => Date) {
    this.repository = repository;
    this.generateId = generateId;
    this.now = now;
  }

  createCourse(input: CreateCourseInput): Course {
    const title = input.title.trim();
    const objective = input.objective.trim();
    if (!title) throw new CourseError('invalid-input', 'Course title cannot be empty.');
    if (!objective) throw new CourseError('invalid-input', 'Course objective cannot be empty.');
    if (!isCourseMode(input.mode)) {
      throw new CourseError('invalid-input', 'Mode must be source_grounded, generated_curriculum, or hybrid.');
    }
    const timestamp = this.now().toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = this.generateId();
      this.validateId(id);
      const course: Course = { id, title, mode: input.mode, objective, createdAt: timestamp, updatedAt: timestamp };
      try {
        this.repository.create(course);
        return course;
      } catch (error) {
        if (error instanceof CourseError && error.code === 'duplicate-id') continue;
        throw this.storageError(error);
      }
    }
    throw new CourseError('duplicate-id', 'Could not allocate a unique course ID. Try creating the course again.');
  }

  listCourses(): Course[] {
    try {
      return this.repository.list();
    } catch (error) {
      throw this.storageError(error);
    }
  }

  getCourse(id: string): Course {
    this.validateId(id);
    let course: Course | undefined;
    try {
      course = this.repository.getById(id);
    } catch (error) {
      throw this.storageError(error);
    }
    if (!course) throw new CourseError('not-found', `Course ${id} was not found.`);
    return course;
  }

  private validateId(id: string): void {
    if (!isCourseId(id)) throw new CourseError('invalid-input', 'Invalid course ID. Expected course-<UUID v4>.');
  }

  private storageError(cause: unknown): CourseError {
    return new CourseError('storage', 'Course storage could not complete the operation. Please try again.', { cause });
  }
}
