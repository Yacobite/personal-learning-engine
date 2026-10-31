import { ObsidianError, obsidianFormat } from '../../domain/obsidian.ts';
import { createHash } from 'node:crypto';
export const markers = { gs: '<!-- LEARNING_ENGINE:GENERATED:START -->', ge: '<!-- LEARNING_ENGINE:GENERATED:END -->', us: '<!-- LEARNING_ENGINE:USER:START -->', ue: '<!-- LEARNING_ENGINE:USER:END -->' };
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export function decode(bytes: Buffer): string { try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
catch {
    throw new ObsidianError('Managed note is not valid UTF-8.');
} }
export function metadata(text: string): Record<string, unknown> {
    const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (!header)
        throw new ObsidianError('Managed note lacks generated frontmatter.');
    const result: Record<string, unknown> = Object.create(null);
    for (const line of header[1]!.split(/\r?\n/)) {
        const m = /^([a-z_]+): (.+)$/.exec(line);
        if (!m || Object.hasOwn(result, m[1]!))
            throw new ObsidianError('Malformed generated frontmatter.');
        try {
            result[m[1]!] = JSON.parse(m[2]!);
        }
        catch {
            throw new ObsidianError('Malformed generated frontmatter.');
        }
    }
    if (result.learning_engine !== true || result.export_format !== obsidianFormat || typeof result.note_key !== 'string')
        throw new ObsidianError('File is not an owned learning-engine note.');
    return result;
}
export function parseNote(bytes: Buffer, key?: string) {
    const text = decode(bytes), positions = Object.values(markers).map(marker => { if (text.split(marker).length !== 2)
        throw new ObsidianError('Missing or duplicate note markers.'); return text.indexOf(marker); });
    if (!positions.every((p, i) => i === 0 || p > positions[i - 1]!))
        throw new ObsidianError('Malformed note marker ordering.');
    const meta = metadata(text);
    if (key && meta.note_key !== key)
        throw new ObsidianError('Managed note identity conflicts with its mapping.');
    const header = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)![0];
    if (text.slice(header.length, positions[0]).trim())
        throw new ObsidianError('Unexpected text before generated region; inspect file.');
    return { meta, user: text.slice(positions[2]! + markers.us.length, positions[3]), tail: text.slice(positions[1]! + markers.ge.length) };
}
export function renderNote(key: string, fields: Record<string, unknown>, body: string, existing: Buffer | null): Buffer {
    if (Object.values(markers).some(m => body.includes(m)))
        throw new ObsidianError('Unsafe generated marker syntax.');
    const prior = existing ? parseNote(existing, key) : null;
    const meta = { learning_engine: true, export_format: obsidianFormat, note_key: key, ...fields };
    const header = '---\n' + Object.entries(meta).map(([k, v]) => k + ': ' + JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')).join('\n') + '\n---\n';
    const tail = prior?.tail ?? '\n\n' + markers.us + '\n## My Notes\n\n' + markers.ue + '\n';
    return Buffer.from(header + markers.gs + '\n' + body.trim() + '\n' + markers.ge + tail, 'utf8');
}
