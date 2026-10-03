import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import type { ResearchBrief, ResearchReference } from '../domain/research.ts';
import type { OfficialResearcher } from '../ports/research.ts';
import { WebParser } from '../ingestion/web-parser.ts';
/** Fixed seeds, no crawl. The model cannot supply or alter this configuration. */
export const pythonSeeds = [
    { path: 'introduction.html', topics: ['values', 'expressions', 'variables', 'strings', 'lists'] },
    { path: 'controlflow.html', topics: ['booleans', 'branching', 'loops', 'functions', 'parameters', 'returns'] },
    { path: 'datastructures.html', topics: ['collections', 'iteration'] },
    { path: 'modules.html', topics: ['modules', 'scope'] },
    { path: 'inputoutput.html', topics: ['input/output', 'files'] },
    { path: 'errors.html', topics: ['errors', 'exceptions'] },
] as const;
const approvedPaths = new Set(pythonSeeds.map((seed) => `/3/tutorial/${seed.path}`));
export function approvedUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname.replace(/^\[|\]$/g, ''))
        || url.origin !== 'https://docs.python.org' || !approvedPaths.has(url.pathname) || url.search || url.hash) {
        throw new Error('Research URL is outside the fixed HTTPS Python tutorial policy.');
    }
    return url;
}
/** Intentionally IPv4-only in M3; reject all IPv6 rather than incompletely classify it. */
export function publicIpv4(address: string): boolean {
    if (isIP(address) !== 4)
        return false;
    const [a, b, c] = address.split('.').map(Number) as [
        number,
        number,
        number,
        number
    ];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export interface HttpEvidenceResponse {
    readonly status: number;
    readonly contentType: string;
    readonly encoding: string;
    readonly location?: string;
    readonly contentLength?: number;
    readonly body: AsyncIterable<Uint8Array>;
}
export type Resolver = (hostname: string) => Promise<readonly string[]>;
export type Transport = (url: URL, address: string, signal: AbortSignal) => Promise<HttpEvidenceResponse>;
export const resolvePublicHost: Resolver = async (hostname) => (await lookup(hostname, { all: true, family: 4 })).map((item) => item.address);
/** A fresh socket with pinned lookup; SNI and certificate validation retain the approved hostname. */
export function makePinnedHttps(requestImpl: typeof request = request): Transport {
    return (url, address, signal) => new Promise((resolve, reject) => {
        const req = requestImpl(url, {
            method: 'GET', agent: false, family: 4, servername: url.hostname,
            rejectUnauthorized: true, signal, maxHeaderSize: 16384,
            lookup: (_hostname, _options, callback) => callback(null, address, 4),
            headers: { 'User-Agent': 'PersonalLearningEngine-M3/1', Accept: 'text/html', 'Accept-Encoding': 'identity' },
        }, (res) => {
            const socket = res.socket as TLSSocket;
            const remote = socket.remoteAddress?.replace(/^::ffff:/, '');
            if (!socket.authorized || remote !== address) {
                res.destroy();
                reject(new Error('TLS peer/address verification failed.'));
                return;
            }
            const location = res.headers.location;
            const length = res.headers['content-length'];
            resolve({ status: res.statusCode ?? 0, contentType: res.headers['content-type'] ?? '', encoding: res.headers['content-encoding'] ?? 'identity',
                ...(location ? { location } : {}), ...(length ? { contentLength: Number(length) } : {}), body: res });
            // Redirect bodies are discarded; rejected responses are aborted by the client.
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0))
                res.destroy();
        });
        req.once('error', reject);
        req.end();
    });
}
export const pinnedHttps = makePinnedHttps();
export class BoundedDocsClient {
    private readonly resolver: Resolver;
    private readonly transport: Transport;
    private readonly timeoutMs: number;
    private readonly maxBytes: number;
    private readonly maxRedirects: number;
    constructor(options: {
        resolver?: Resolver;
        transport?: Transport;
        timeoutMs?: number;
        maxBytes?: number;
        maxRedirects?: number;
    } = {}) {
        this.resolver = options.resolver ?? resolvePublicHost;
        this.transport = options.transport ?? pinnedHttps;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
        this.maxRedirects = options.maxRedirects ?? 2;
    }
    async retrieve(value: string): Promise<{
        url: string;
        bytes: Uint8Array;
    }> {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const work = async () => {
            let url = approvedUrl(value);
            const visited = new Set<string>();
            for (let redirects = 0;; redirects++) {
                controller.signal.throwIfAborted();
                if (visited.has(url.href)) throw new Error('Research redirect loop rejected.');
                visited.add(url.href);
                const addresses = await this.resolver(url.hostname);
                if (!addresses.length || addresses.some((address) => !publicIpv4(address)))
                    throw new Error('Research DNS contains a prohibited address.');
                controller.signal.throwIfAborted();
                const response = await this.transport(url, addresses[0]!, controller.signal);
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    if (!response.location || redirects >= this.maxRedirects)
                        throw new Error('Research redirect limit/target rejected.');
                    url = approvedUrl(new URL(response.location, url).href);
                    continue;
                }
                if (response.status !== 200)
                    throw new Error('Research document unavailable.');
                if (!/^text\/html(?:\s*;|$)/i.test(response.contentType) || response.encoding !== 'identity')
                    throw new Error('Research content type/encoding rejected.');
                if (response.contentLength !== undefined && (!Number.isSafeInteger(response.contentLength) || response.contentLength < 0 || response.contentLength > this.maxBytes))
                    throw new Error('Research response too large.');
                const chunks: Uint8Array[] = [];
                let size = 0;
                for await (const chunk of response.body) {
                    controller.signal.throwIfAborted();
                    size += chunk.byteLength;
                    if (size > this.maxBytes)
                        throw new Error('Research response too large.');
                    chunks.push(chunk);
                }
                return { url: url.href, bytes: Buffer.concat(chunks, size) };
            }
        };
        try {
            return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('Research timeout.')); }, this.timeoutMs);
                })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            controller.abort();
        }
    }
}
export class PythonDocsResearcher implements OfficialResearcher {
    private readonly client: BoundedDocsClient;
    constructor(client = new BoundedDocsClient()) { this.client = client; }
    async retrieve(courseId: string, goal: string): Promise<ResearchBrief> {
        const references: ResearchReference[] = [];
        const visited = new Set<string>();
        const parser = new WebParser();
        for (const seed of pythonSeeds) {
            const initial = `https://docs.python.org/3/tutorial/${seed.path}`;
            const base = { id: `reference-${randomUUID()}`, publisher: 'Python Software Foundation' as const,
                authority: 'official_documentation' as const, topics: [...seed.topics] };
            try {
                if (visited.has(initial))
                    throw new Error('Duplicate seed');
                visited.add(initial);
                const retrieved = await this.client.retrieve(initial);
                const retrievedAt = new Date().toISOString();
                if (retrieved.url !== initial && visited.has(retrieved.url))
                    throw new Error('Duplicate final document');
                visited.add(retrieved.url);
                const document = await parser.parse({ kind: 'web', identityKey: retrieved.url, location: retrieved.url, requestedLocation: initial,
                    title: '', origin: 'learner_url', bytes: retrieved.bytes, retrievedAt });
                const text = document.segments.map((segment) => segment.text).join('\n');
                if (!text.trim() || text.length > 250000)
                    throw new Error('Unusable research extraction');
                references.push({ ...base, url: retrieved.url, title: document.title || null, retrievedAt,
                    contentHash: createHash('sha256').update(retrieved.bytes).digest('hex'), status: 'ready', text,
                    notes: ['Official publisher is assigned by trusted origin policy. Topic tags are retrieval hints, not verified concept claims.',
                        'Text extraction preserves evidence, not document layout; content hash identifies received HTML bytes.'] });
            }
            catch {
                references.push({ ...base, url: initial, title: null, retrievedAt: new Date().toISOString(), contentHash: null, status: 'failed', text: '',
                    notes: ['Retrieval/extraction unavailable or rejected by policy; this item cannot ground a curriculum node.'] });
            }
        }
        return { id: `brief-${randomUUID()}`, courseId, goal, createdAt: new Date().toISOString(), references };
    }
}
