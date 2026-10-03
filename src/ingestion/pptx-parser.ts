import { unzipSync } from 'fflate';
import { posix } from 'node:path';
import type { SourceInput } from '../domain/source-input.ts';
import type { ExtractionWarning, NormalizedDocument, NormalizedSegment } from '../domain/source.ts';
import type { SourceParser } from '../ports/source-parser.ts';
import { all, attr, text, xml } from './dom.ts';
import { decodeText } from './text-parser.ts';

/** Only bounded XML parts are expanded; no embedded objects or media are executed. */
export class PptxParser implements SourceParser {
  supports(input: SourceInput): boolean { return input.kind === 'pptx'; }
  async parse(input: SourceInput): Promise<NormalizedDocument> {
    let expanded = 0;
    let entries = 0;
    const files = unzipSync(input.bytes, { filter: (file) => {
      if (++entries > 10_000) throw new Error('Archive entry limit');
      const needed = /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(?:slide\d+\.xml|_rels\/slide\d+\.xml\.rels)|notesSlides\/notesSlide\d+\.xml)$/.test(file.name);
      if (needed) {
        expanded += file.originalSize;
        if (file.originalSize > 8 * 1024 * 1024 || expanded > 32 * 1024 * 1024) throw new Error('Archive expansion limit');
      }
      return needed;
    } });
    const get = (path: string) => {
      const bytes = files[path];
      if (!bytes) throw new Error('Missing presentation part');
      return xml(decodeText(bytes));
    };
    const relationships = all(get('ppt/_rels/presentation.xml.rels'), 'Relationship');
    const slides = all(get('ppt/presentation.xml'), 'p:sldId');
    if (!slides.length || slides.length > 2000) throw new Error('Invalid slide count');
    const segments: NormalizedSegment[] = [];
    const warnings: ExtractionWarning[] = [{ code: 'visual_extraction_deferred',
      message: 'Slide text follows XML shape order. Diagrams, images, tables, and spatial layout were not visually interpreted.' }];
    let incomplete = false;
    for (const [index, slide] of slides.entries()) {
      const relationship = relationships.find((entry) => attr(entry, 'Id') === attr(slide, 'r:id'));
      if (!relationship || attr(relationship, 'TargetMode') === 'External') throw new Error('Invalid slide relationship');
      const path = posix.normalize(posix.join('ppt', attr(relationship, 'Target') ?? ''));
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(path)) throw new Error('Unsafe slide target');
      const document = get(path);
      const shapeTitle = all(document, 'p:sp').find((shape) => all(shape, 'p:ph')
        .some((placeholder) => ['title', 'ctrTitle'].includes(attr(placeholder, 'type') ?? '')));
      const title = shapeTitle ? all(shapeTitle, 'a:t').map(text).join(' ').trim() : '';
      const value = all(document, 'a:p').map((paragraph) => all(paragraph, 'a:t').map(text).join('')).filter(Boolean).join('\n');
      const anchor = { kind: 'pptx' as const, slide: index + 1, part: 'slide' as const };
      if (!value.trim()) {
        incomplete = true;
        warnings.push({ code: 'empty_slide', anchor, message: `Slide ${index + 1} has no extractable text.` });
      }
      segments.push({ order: segments.length, text: value, headingPath: title ? [title] : [], anchor,
        visualRefs: [`pptx-slide:${index + 1}:rendering-deferred`] });
      const relPath = posix.join(posix.dirname(path), '_rels', `${posix.basename(path)}.rels`);
      if (files[relPath]) {
        const noteRel = all(get(relPath), 'Relationship').find((entry) => attr(entry, 'Type')?.endsWith('/notesSlide'));
        if (noteRel && attr(noteRel, 'TargetMode') !== 'External') {
          const notePath = posix.normalize(posix.join(posix.dirname(path), attr(noteRel, 'Target') ?? ''));
          if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(notePath)) throw new Error('Unsafe notes target');
          const notes = all(get(notePath), 'p:sp').filter((shape) => !all(shape, 'p:ph')
            .some((p) => ['sldNum', 'hdr', 'ftr', 'dt'].includes(attr(p, 'type') ?? '')))
            .flatMap((shape) => all(shape, 'a:p').map((p) => all(p, 'a:t').map(text).join(''))).filter(Boolean).join('\n');
          if (notes.trim()) segments.push({ order: segments.length, text: `[Speaker notes]\n${notes}`,
            headingPath: title ? [title, 'Speaker notes'] : ['Speaker notes'],
            anchor: { kind: 'pptx', slide: index + 1, part: 'notes' }, visualRefs: [] });
        }
      }
    }
    return { title: input.title, parser: 'fflate:0.8.3:htmlparser2:12.0.0:pptx-v1',
      status: incomplete ? 'extraction_incomplete' : 'ready_with_warnings', warnings,
      metadata: { slideCount: slides.length, textOrder: 'presentation order, then XML shape order' }, segments };
  }
}
