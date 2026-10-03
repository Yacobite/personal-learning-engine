import type { Course } from '../../domain/course.ts';
import type { CourseService } from '../../services/course-service.ts';

/** One instance per live Pi session. Selection never writes persistent preferences. */
export class CourseSession {
  private activeId: string | undefined;

  use(id: string, service: Pick<CourseService, 'getCourse'>): Course {
    const course = service.getCourse(id);
    this.activeId = course.id;
    return course;
  }

  current(service: Pick<CourseService, 'getCourse'>): Course | undefined {
    return this.activeId ? service.getCourse(this.activeId) : undefined;
  }

  clear(): void {
    this.activeId = undefined;
  }
}
