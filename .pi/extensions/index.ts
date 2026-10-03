import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createHash, randomUUID } from 'node:crypto';
import { openLearningDatabase } from '../../src/persistence/database.ts';
import type { SqliteFoundationStore } from '../../src/persistence/database.ts';
import { FoundationService } from '../../src/services/foundation-service.ts';
import { registerLearningStatus } from '../../src/runtime/pi/register-status.ts';
import { CourseService } from '../../src/services/course-service.ts';
import { CourseSession } from '../../src/runtime/pi/course-session.ts';
import { registerCourse } from '../../src/runtime/pi/register-course.ts';
import { registerSource } from '../../src/runtime/pi/register-source.ts';
import { SourceService } from '../../src/services/source-service.ts';
import { ProjectSourceReader } from '../../src/ingestion/input-reader.ts';
import { PdfParser } from '../../src/ingestion/pdf-parser.ts';
import { PptxParser } from '../../src/ingestion/pptx-parser.ts';
import { TextParser } from '../../src/ingestion/text-parser.ts';
import { WebParser } from '../../src/ingestion/web-parser.ts';
import { YoutubeParser } from '../../src/ingestion/youtube-parser.ts';

/** Composition root only: construct adapters and bind the session lifecycle. */
export default function learningFoundation(pi: ExtensionAPI): void {
  let store: SqliteFoundationStore | undefined;
  let service: FoundationService | undefined;
  let courseService: CourseService | undefined;
  let sourceService: SourceService | undefined;
  const selection = new CourseSession();

  const close = (): void => {
    selection.clear();
    store?.close();
    store = undefined;
    service = undefined;
    courseService = undefined;
    sourceService = undefined;
  };

  pi.on('session_start', (_event, ctx) => {
    close();
    store = openLearningDatabase(ctx.cwd);
    service = new FoundationService(store);
    courseService = new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
    sourceService = new SourceService(courseService, store.sources, new ProjectSourceReader(ctx.cwd),
      [new PdfParser(), new PptxParser(), new TextParser(), new WebParser(), new YoutubeParser()],
      (bytes) => createHash('sha256').update(bytes).digest('hex'), () => `source-${randomUUID()}`);
  });
  pi.on('session_shutdown', close);
  registerLearningStatus(pi, () => {
    if (!service) throw new Error('Learning foundation session has not started.');
    return service;
  });
  registerCourse(pi, () => {
    if (!courseService) throw new Error('Learning foundation session has not started.');
    return { service: courseService, selection };
  });
  registerSource(pi, () => {
    if (!sourceService || !courseService) throw new Error('Learning foundation session has not started.');
    return { sources: sourceService, courses: courseService, selection };
  });
}
