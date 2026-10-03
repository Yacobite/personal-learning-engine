export const courseModes = ['source_grounded', 'generated_curriculum', 'hybrid'] as const;
export type CourseMode = typeof courseModes[number];

export interface Course {
  readonly id: string;
  readonly title: string;
  readonly mode: CourseMode;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isCourseMode(value: string): value is CourseMode {
  return courseModes.some((mode) => mode === value);
}

export function isCourseId(value: string): boolean {
  return /^course-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export class CourseError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'duplicate-id' | 'storage';

  constructor(code: CourseError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CourseError';
    this.code = code;
  }
}
