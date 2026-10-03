import type { IngestionRequest, SourceInput } from '../domain/source-input.ts';

export interface SourceInputReader {
  read(request: IngestionRequest): Promise<SourceInput>;
}
