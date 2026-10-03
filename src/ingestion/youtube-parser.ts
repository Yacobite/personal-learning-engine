import type { SourceInput } from '../domain/source-input.ts';
import type { NormalizedDocument, NormalizedSegment } from '../domain/source.ts';
import type { SourceParser } from '../ports/source-parser.ts';
import { decodeText } from './text-parser.ts';

function seconds(value: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('Invalid caption time');
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
export class YoutubeParser implements SourceParser {
  supports(input: SourceInput): boolean { return input.kind === 'youtube'; }
  async parse(input: SourceInput): Promise<NormalizedDocument> {
    const metadata = { videoId: input.videoId ?? '', captionOrigin: input.captionsLocation ? 'learner_supplied_webvtt' : 'unavailable' };
    if (!input.captionsLocation) return { title: input.title, parser: 'webvtt-v1',
      status: 'transcript_unavailable', metadata, segments: [], warnings: [{ code: 'transcript_unavailable',
        message: 'No captions supplied. M2 does not scrape YouTube or transcribe audio. Add an explicitly obtained WebVTT file with --captions.' }] };
    const captionText = decodeText(input.bytes).replace(/\r\n/g, '\n');
    if (!/^WEBVTT(?:\s|$)/.test(captionText)) throw new Error('Invalid WebVTT header');
    const segments: NormalizedSegment[] = [];
    for (const block of captionText.split(/\n\s*\n/).slice(1)) {
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block.trim())) continue;
      const lines = block.split('\n');
      const index = lines.findIndex((line) => line.includes('-->'));
      if (index < 0) continue;
      const timing = /^(\S+)\s+-->\s+(\S+)/.exec(lines[index]!);
      if (!timing) throw new Error('Invalid WebVTT cue');
      const startSeconds = seconds(timing[1]!);
      const endSeconds = seconds(timing[2]!);
      if (endSeconds < startSeconds) throw new Error('Invalid cue range');
      const value = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').trim();
      if (value) segments.push({ order: segments.length, text: value, headingPath: [], visualRefs: [],
        anchor: { kind: 'youtube', startSeconds, endSeconds } });
    }
    return { title: input.title, parser: 'webvtt-v1', metadata,
      status: segments.length ? 'ready_with_warnings' : 'extraction_incomplete',
      warnings: [{ code: 'caption_fidelity', message: 'Learner-supplied captions are unverified text; title/channel/language are not inferred. Visuals and audio were not inspected.' }], segments };
  }
}
