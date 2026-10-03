import { zipSync, strToU8 } from 'fflate';
import type { SourceInput } from '../../src/domain/source-input.ts';
import type { SourceKind } from '../../src/domain/source.ts';

export function input(kind: SourceKind, text: string | Uint8Array, extra: Partial<SourceInput> = {}): SourceInput {
  return { kind, title: 'Synthetic fixture', identityKey: `fixture:${kind}`, location: `fixture:${kind}`,
    requestedLocation: `fixture:${kind}`, origin: 'learner_file', bytes: typeof text === 'string' ? strToU8(text) : text,
    retrievedAt: '2026-10-03T12:00:00.000Z', ...extra };
}
/** Synthetic two-page PDF: native text on page 1, genuinely empty page 2. */
export function pdfFixture(): Uint8Array {
  const stream = 'BT /F1 16 Tf 30 750 Td (Implication is a logical connective. This is synthetic test material.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(pdf);
}
export function pptxFixture(): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, value: string) => { files[path] = strToU8(value); };
  put('ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>');
  put('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>');
  for (const slide of [1, 2]) put(`ppt/slides/slide${slide}.xml`, `<p:sld><p:sp><p:ph type="title"/><a:p><a:r><a:t>Slide file ${slide}</a:t></a:r></a:p></p:sp><p:sp><a:p><a:r><a:t>Implication body ${slide}</a:t></a:r></a:p></p:sp></p:sld>`);
  put('ppt/slides/_rels/slide2.xml.rels', '<Relationships><Relationship Type="x/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>');
  put('ppt/notesSlides/notesSlide2.xml', '<p:notes><p:sp><p:ph type="body"/><a:p><a:r><a:t>A speaker note</a:t></a:r></a:p></p:sp></p:notes>');
  return zipSync(files);
}
