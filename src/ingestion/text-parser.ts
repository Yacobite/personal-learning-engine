import type { SourceInput } from '../domain/source-input.ts';
import type { NormalizedDocument, NormalizedSegment } from '../domain/source.ts';
import type { SourceParser } from '../ports/source-parser.ts';

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export const CHUNK_SIZE = 4000;
export function chunks(text: string, start = 0): { text: string; start: number; end: number }[] {
  const result = [];
  for (let offset = 0; offset < text.length; offset += CHUNK_SIZE) {
    result.push({ text: text.slice(offset, offset + CHUNK_SIZE), start: start + offset,
      end: start + Math.min(text.length, offset + CHUNK_SIZE) });
  }
  return result;
}
export class TextParser implements SourceParser {
  supports(input: SourceInput): boolean { return input.kind === 'text' || input.kind === 'markdown'; }
  async parse(input: SourceInput): Promise<NormalizedDocument> {
    const text = decodeText(input.bytes);
    const segments: NormalizedSegment[] = [];
    const headings: { level: number; title: string }[] = [];
    let section = 0;
    let start = 0;
    let offset = 0;
    let fenced = false;
    let fence = '';
    let fenceLength = 0;
    const flush = (end: number): void => {
      for (const chunk of chunks(text.slice(start, end), start)) {
        if (!chunk.text.trim()) continue;
        segments.push({ order: segments.length, text: chunk.text, headingPath: headings.map((h) => h.title), visualRefs: [],
          anchor: input.kind === 'text' ? { kind: 'text', startOffset: chunk.start, endOffset: chunk.end }
            : { kind: 'markdown', section, startOffset: chunk.start, endOffset: chunk.end } });
      }
    };
    if (input.kind === 'markdown') {
      const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      let skipUnderline = false;
      for (const [lineIndex, line] of lines.entries()) {
        if (skipUnderline) { offset += line.length; skipUnderline = false; continue; }
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
          if (!fenced) { fenced = true; fence = marker[0]!; fenceLength = marker.length; }
          else if (marker[0] === fence && marker.length >= fenceLength && line.trim() === marker) fenced = false;
        }
        const atx = !fenced && !marker ? /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trimEnd()) : null;
        const underline = !fenced && !marker && line.trim() ? /^ {0,3}(=+|-+)\s*$/.exec(lines[lineIndex + 1] ?? '') : null;
        const headingLevel = atx ? atx[1]!.length : underline ? (underline[1]![0] === '=' ? 1 : 2) : 0;
        if (headingLevel) {
          flush(offset); start = offset; section++;
          while (headings.length && headings.at(-1)!.level >= headingLevel) headings.pop();
          headings.push({ level: headingLevel, title: atx ? atx[2]! : line.trim() });
          skipUnderline = !!underline;
        }
        offset += line.length;
      }
    }
    flush(text.length);
    return { title: input.title, parser: 'text-sections-v1', status: segments.length ? 'ready' : 'extraction_incomplete',
      warnings: segments.length ? [] : [{ code: 'empty_text', message: 'No readable text was found.' }],
      metadata: { offsetUnit: 'UTF-16 code units', encoding: 'UTF-8', sectionCount: section }, segments };
  }
}
