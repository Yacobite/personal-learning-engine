import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import type { SourceInput } from '../domain/source-input.ts';
import type { ExtractionWarning, NormalizedDocument, NormalizedSegment } from '../domain/source.ts';
import type { SourceParser } from '../ports/source-parser.ts';

export class PdfParser implements SourceParser {
  supports(input: SourceInput): boolean { return input.kind === 'pdf'; }
  async parse(input: SourceInput): Promise<NormalizedDocument> {
    const task = getDocument({ data: new Uint8Array(input.bytes),
      useSystemFonts: false, disableFontFace: true, stopAtErrors: true,
      standardFontDataUrl: fileURLToPath(new URL('standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))).replace(/\\/g, '/'),
      cMapUrl: fileURLToPath(new URL('cmaps/', import.meta.resolve('pdfjs-dist/package.json'))).replace(/\\/g, '/'), cMapPacked: true,
      // Only bundled font/maps are read; extraction never fetches source-selected URLs.
      useWorkerFetch: false });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 2000) throw new Error('Page limit');
      const segments: NormalizedSegment[] = [];
      const warnings: ExtractionWarning[] = [{ code: 'visual_extraction_deferred',
        message: 'Native text only. Diagrams, formulas, tables, and spatial reading order require future rendered-page inspection.' }];
      let incomplete = false;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const anchor = { kind: 'pdf' as const, page: pageNumber };
        let text = '';
        try {
          const content = await page.getTextContent();
          for (const item of content.items) {
            if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
          }
          text = text.trim();
          if (text.length < 40) {
            incomplete = true;
            warnings.push({ code: text ? 'sparse_page' : 'empty_page', anchor,
              message: `PDF page ${pageNumber} has ${text ? 'little' : 'no'} extractable text; visual content was not understood.` });
          }
        } catch {
          incomplete = true;
          warnings.push({ code: 'page_extraction_failed', anchor, message: `PDF page ${pageNumber} could not be extracted.` });
        }
        // Empty pages remain addressable, but cannot produce FTS matches.
        segments.push({ order: segments.length, text, anchor, headingPath: [],
          visualRefs: [`pdf-page:${pageNumber}:rendering-deferred`] });
        page.cleanup();
      }
      let title = input.title;
      try {
        const metadata = await pdf.getMetadata();
        const info = metadata.info as { Title?: unknown };
        if (typeof info.Title === 'string' && info.Title.trim()) title = info.Title.trim();
      } catch { warnings.push({ code: 'metadata_unavailable', message: 'PDF title metadata could not be read.' }); }
      return { title, parser: `pdfjs-dist:${version}:native-pages-v1`,
        status: incomplete ? 'extraction_incomplete' : 'ready_with_warnings', warnings,
        metadata: { pageCount: pdf.numPages, extraction: 'native-text', rendered: false,
          pageNumbering: '1-based physical PDF page; printed slide numbers may differ' }, segments };
    } finally { await task.destroy(); }
  }
}
