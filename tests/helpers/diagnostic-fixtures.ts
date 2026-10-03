import { fixture, ids } from './assessment-fixtures.ts';
import { DiagnosticService } from '../../src/services/diagnostic-service.ts';
import { DiagnosticContextBuilder } from '../../src/services/diagnostic-context.ts';
import type { DiagnosticTaskGenerator } from '../../src/ports/diagnostic-generator.ts';
export const syntheticGenerator: DiagnosticTaskGenerator = { propose: async (c) => ({ prompt: `SYNTHETIC ORCHESTRATION ONLY: fixture response for ${c.conceptId}. This does not assess course knowledge.`, scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' }, sourceRefs: c.source.map(s => s.ref), researchRefs: c.research.map(r => r.ref) }) };
export const answer = (response = 'alpha') => ({ response, assistance: 'none' as const, hints: { count: 0, highestLevel: 'none' as const, notes: null } });
export function diagnostics(f: ReturnType<typeof fixture>) { return new DiagnosticService(f.store.diagnostics, f.store.assessments, f.graphs, f.assessments, f.evaluations, new DiagnosticContextBuilder(f.store.sources, f.store.research), ids, () => new Date('2026-10-03T14:00:00.000Z')); }
