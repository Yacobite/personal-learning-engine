import { parseDocument } from 'htmlparser2';
import type { SourceInput } from '../domain/source-input.ts';
import type { NormalizedDocument, NormalizedSegment } from '../domain/source.ts';
import type { SourceParser } from '../ports/source-parser.ts';
import { all, attr, children, name, text } from './dom.ts';
import type { DomNode } from './dom.ts';
import { chunks, decodeText } from './text-parser.ts';

export class WebParser implements SourceParser {
  supports(input: SourceInput): boolean { return input.kind === 'web'; }
  async parse(input: SourceInput): Promise<NormalizedDocument> {
    const dom = parseDocument(decodeText(input.bytes), { decodeEntities: true, withStartIndices: true, withEndIndices: true });
    const title = all(dom, 'title').map(text).join(' ').trim() || input.title;
    const root = all(dom, 'main')[0] ?? all(dom, 'article')[0] ?? all(dom, 'body')[0] ?? dom;
    const blocks: { value: string; heading: number; offset: number; end: number }[] = [];
    const excluded = new Set(['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript', 'template']);
    const walk = (node: DomNode): void => {
      const tag = name(node);
      if (excluded.has(tag) || attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden') === 'true'
        || /(?:^|[\s_-])(advert|advertisement|cookie|navigation|sidebar)(?:$|[\s_-])/i.test(`${attr(node, 'class') ?? ''} ${attr(node, 'id') ?? ''}`)) return;
      const heading = /^h([1-6])$/.exec(tag);
      if (heading || ['p', 'li', 'pre', 'blockquote', 'td', 'th'].includes(tag)) {
        // Sanitize descendants too; nested script text never enters source text.
        const readable = (entry: DomNode): string => excluded.has(name(entry)) ? ''
          : entry.type === 'text' ? text(entry) : children(entry).map(readable).join(' ');
        const value = readable(node).replace(/\s+/g, ' ').trim();
        if (value) blocks.push({ value, heading: heading ? Number(heading[1]) : 0, offset: node.startIndex ?? 0, end: (node.endIndex ?? 0) + 1 });
      } else if (node.type === 'text' && text(node).trim()) {
        blocks.push({ value: text(node).replace(/\s+/g, ' ').trim(), heading: 0, offset: node.startIndex ?? 0, end: (node.endIndex ?? 0) + 1 });
      } else children(node).forEach(walk);
    };
    walk(root);
    const segments: NormalizedSegment[] = [];
    const headings: { level: number; title: string }[] = [];
    let section = 0;
    let content = '';
    let startOffset = 0;
    let endOffset = 0;
    const flush = (): void => {
      for (const chunk of chunks(content)) {
        segments.push({ order: segments.length, text: chunk.text, headingPath: headings.map((h) => h.title), visualRefs: [],
          anchor: { kind: 'web', section, startOffset, endOffset } });
      }
      content = '';
    };
    for (const block of blocks) {
      if (block.heading) {
        flush(); section++;
        while (headings.length && headings.at(-1)!.level >= block.heading) headings.pop();
        headings.push({ level: block.heading, title: block.value });
      }
      if (!content) startOffset = block.offset;
      content += `${block.value}\n`;
      endOffset = block.end;
    }
    flush();
    return { title, parser: 'htmlparser2:12.0.0:readable-sections-v1',
      status: segments.length ? 'ready_with_warnings' : 'extraction_incomplete',
      warnings: [{ code: 'html_fidelity', message: 'Static UTF-8 HTML only; main-content selection is heuristic. Scripts, navigation, and visual layout are omitted.' }],
      metadata: { sectionCount: section, offsetUnit: 'raw HTML UTF-16 code units, end exclusive', scriptsExecuted: false }, segments };
  }
}
