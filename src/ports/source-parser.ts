import type { SourceInput } from '../domain/source-input.ts';
import type { NormalizedDocument } from '../domain/source.ts';

export interface SourceParser {
  supports(input: SourceInput): boolean;
  parse(input: SourceInput): Promise<NormalizedDocument>;
}
