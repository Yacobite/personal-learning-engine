import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SourceError } from '../domain/source.ts';
import type { SourceKind } from '../domain/source.ts';
import type { IngestionRequest, SourceInput } from '../domain/source-input.ts';
import type { SourceInputReader } from '../ports/source-input-reader.ts';

const MAX_BYTES = 32 * 1024 * 1024;
function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}
export interface HtmlResponse { readonly bytes: Uint8Array; readonly finalUrl: string }
export type HtmlFetcher = (url: string) => Promise<HtmlResponse>;

function safeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceError('invalid-input', 'Invalid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new SourceError('invalid-input', 'Only HTTP(S) URLs without credentials are supported.');
  }
  url.hash = '';
  return url;
}
/** One supplied URL plus HTTP redirects; no cookies, authorization, scripts, or crawling. */
export const fetchHtml: HtmlFetcher = async (value) => {
  let url = safeUrl(value);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetch(url, { redirect: 'manual', credentials: 'omit',
        signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/html,application/xhtml+xml' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('Redirect limit');
        url = safeUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP failure'); }
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel(); throw new SourceError('unsupported', 'URL must return HTML in M2.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.length;
          if (size > MAX_BYTES) throw new Error('Size limit');
          chunks.push(result.value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { bytes, finalUrl: url.href };
    }
  } catch (cause) {
    if (cause instanceof SourceError) throw cause;
    throw new SourceError('fetch', 'HTML retrieval failed (HTTP, timeout, redirect, or size limit).', { cause });
  }
  throw new SourceError('fetch', 'HTML retrieval failed.');
};

export class ProjectSourceReader implements SourceInputReader {
  private readonly workspace: string;
  private readonly fetcher: HtmlFetcher;
  private readonly now: () => Date;
  constructor(workspace: string, fetcher: HtmlFetcher = fetchHtml, now: () => Date = () => new Date()) {
    this.workspace = resolve(workspace); this.fetcher = fetcher; this.now = now;
  }
  async read(request: IngestionRequest): Promise<SourceInput> {
    const retrievedAt = this.now().toISOString();
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(request.location)) {
      const url = safeUrl(request.location);
      const videoId = this.youtubeId(url);
      if (videoId) {
        const canonical = `https://www.youtube.com/watch?v=${videoId}`;
        const captions = request.captionsPath ? await this.readFile(request.captionsPath) : undefined;
        if (captions && extname(request.captionsPath!).toLowerCase() !== '.vtt') {
          throw new SourceError('unsupported', 'YouTube captions must be an explicitly supplied WebVTT (.vtt) file.');
        }
        return { kind: 'youtube', identityKey: canonical, location: canonical,
          requestedLocation: url.href, title: `YouTube ${videoId}`, origin: 'learner_url',
          bytes: captions?.bytes ?? new TextEncoder().encode(`transcript_unavailable:${videoId}`),
          retrievedAt, videoId, ...(captions ? { captionsLocation: captions.location } : {}) };
      }
      if (request.captionsPath) throw new SourceError('invalid-input', 'Captions are supported only for YouTube URLs.');
      const response = await this.fetcher(url.href);
      const finalUrl = safeUrl(response.finalUrl).href;
      if (response.bytes.length > MAX_BYTES) throw new SourceError('invalid-input', 'Source exceeds 32 MiB.');
      return { kind: 'web', identityKey: finalUrl, location: finalUrl, requestedLocation: url.href,
        title: finalUrl, origin: 'learner_url', bytes: response.bytes, retrievedAt };
    }
    if (request.captionsPath) throw new SourceError('invalid-input', 'Captions require a YouTube URL.');
    const file = await this.readFile(request.location);
    const extension = extname(file.location).toLowerCase();
    const kinds: Record<string, SourceKind> = { '.pdf': 'pdf', '.pptx': 'pptx', '.md': 'markdown',
      '.markdown': 'markdown', '.txt': 'text', '.html': 'web', '.htm': 'web' };
    const kind = kinds[extension];
    if (!kind) throw new SourceError('unsupported', 'Supported files: PDF, PPTX, Markdown, TXT, HTML.');
    return { kind, identityKey: process.platform === 'win32' ? file.location.toLowerCase() : file.location,
      location: file.location, requestedLocation: file.location,
      title: basename(file.location), origin: 'learner_file', bytes: file.bytes, retrievedAt };
  }
  private youtubeId(url: URL): string | undefined {
    const host = url.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) return undefined;
    const id = host.endsWith('youtu.be') ? url.pathname.slice(1).split('/')[0]
      : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id)) throw new SourceError('invalid-input', 'Supply a YouTube video URL with a valid video ID.');
    return id;
  }
  private async readFile(value: string): Promise<{ bytes: Uint8Array; location: string }> {
    const root = await realpath(this.workspace);
    const sourceRoot = join(root, 'sources');
    const target = resolve(root, value);
    if (!within(sourceRoot, target) || target === sourceRoot) throw new SourceError('unsafe-path', 'Source file must be inside project sources/.');
    try {
      // Reject symlinks/junctions at every component, including sources/, before opening.
      const parts = relative(root, target).split(sep);
      let path = root;
      for (const part of parts) {
        path = join(path, part);
        if ((await lstat(path)).isSymbolicLink()) throw new SourceError('unsafe-path', 'Source symlinks/junctions are not accepted.');
      }
      const canonical = await realpath(target);
      if (!within(sourceRoot, canonical)) throw new SourceError('unsafe-path', 'Source resolves outside project sources/.');
      const handle = await open(target, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new SourceError('invalid-input', 'Source must be a regular file of at most 32 MiB.');
        const bytes = new Uint8Array(Number(stat.size));
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) throw new SourceError('invalid-input', 'Source changed while reading; retry.');
          offset += result.bytesRead;
        }
        const after = await handle.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || (await realpath(target)) !== canonical) {
          throw new SourceError('unsafe-path', 'Source changed while reading; retry.');
        }
        // Absolute paths remain transient safety details; persisted locations survive a project move.
        return { bytes, location: relative(root, canonical).split(sep).join('/') };
      } finally { await handle.close(); }
    } catch (cause) {
      if (cause instanceof SourceError) throw cause;
      throw new SourceError('invalid-input', 'Could not read the requested project source file.', { cause });
    }
  }
}
