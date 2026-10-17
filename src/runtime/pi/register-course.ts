import { listWindow } from './command-surface.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { CourseError } from '../../domain/course.ts';
import type { CourseService } from '../../services/course-service.ts';
import type { CourseSession } from './course-session.ts';
import { parseArguments } from './command-arguments.ts';

const usage = 'Usage: /course new <mode> "title" "objective" | /course list | /course use <id> | /course current';

export function registerCourse(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
  getRuntime: () => { service: Pick<CourseService, 'createCourse' | 'listCourses' | 'getCourse'>; selection: CourseSession },
): void {
  pi.registerCommand('course', {
    description: 'Create, list, select, or inspect courses for this session',
    handler: async (args, ctx) => {
      let tokens: string[];
      try { tokens = parseArguments(args); }
      catch { ctx.ui.notify(usage, 'error'); return; }
      try {
        const { service, selection } = getRuntime();
        const [command, ...parameters] = tokens;
        if (command === 'new' && parameters.length === 3) {
          const [mode, title, objective] = parameters as [string, string, string];
          const course = service.createCourse({ mode, title, objective });
          ctx.ui.notify(`Created ${course.id}: ${course.title} (${course.mode}).`, 'info');
        } else if (command === 'list' && parameters.length === 0) {
          const courses = service.listCourses();
          ctx.ui.notify(courses.length
            ? listWindow(courses).map((course) => `${course.id}: ${course.title} (${course.mode})`).join('\n')
            : 'No courses yet. Create one with /course new <mode> "title" "objective".', 'info');
        } else if (command === 'use' && parameters.length === 1) {
          const course = selection.use(parameters[0]!, service);
          ctx.ui.notify(`Using ${course.id}: ${course.title} for this session.`, 'info');
        } else if (command === 'current' && parameters.length === 0) {
          const course = selection.current(service);
          ctx.ui.notify(course ? `Current course: ${course.id}: ${course.title}.`
            : 'No active course in this session. Select one with /course use <id>.', 'info');
        } else {
          ctx.ui.notify(usage, 'error');
        }
      } catch (error) {
        ctx.ui.notify(error instanceof CourseError ? error.message
          : 'Course operation failed. Please retry or restart the session.', 'error');
      }
    },
  });
}
