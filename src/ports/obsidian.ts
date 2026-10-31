import type { ObsidianSnapshot } from '../domain/obsidian.ts';
import type { DiagnosticTaskContext } from './diagnostic-generator.ts';
export interface ObsidianProjectionReader {
    read(courseId: string): ObsidianSnapshot;
    ground(courseId: string, conceptId: string): DiagnosticTaskContext;
}
export interface ObsidianStudyMaterialGenerator {
    propose(context: DiagnosticTaskContext): Promise<unknown>;
}
