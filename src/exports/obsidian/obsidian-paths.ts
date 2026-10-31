import { lstatSync, mkdirSync, realpathSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, readdirSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObsidianError } from '../../domain/obsidian.ts';
const reserved = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
export function readableName(title: string, id: string): string {
    if (!/^[a-z0-9@-]+$/.test(id))
        throw new ObsidianError('Invalid stable file identity.');
    const raw = title.normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*\[\]#^]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
    const stem = Array.from(raw || 'Untitled').slice(0, 24).join('').replace(/[. ]+$/g, '');
    return (reserved.test(stem) ? '_' + stem : stem) + '--' + id.replace(/^[a-z]+-/, '');
}
export interface VaultIO {
    write(path: string, bytes: Buffer): void;
    rename(from: string, to: string): void;
}
export class SafeVault {
    readonly root: string;
    private readonly io: VaultIO;
    constructor(workspace: string, io: VaultIO = { write: (p, b) => writeFileSync(p, b, { flag: 'wx' }), rename: renameSync }) {
        this.io = io;
        const base = realpathSync(workspace);
        this.root = join(base, '_learning', 'obsidian-vault');
        for (const p of [join(base, '_learning'), this.root])
            if (lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())
                throw new ObsidianError('Vault ancestors must not be symbolic links/reparse points.');
    }
    path(rel: string, parents = false): string {
        if (!rel || isAbsolute(rel) || rel.includes('\\') || rel.length > 230 || rel.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*]/.test(p) || /[. ]$/.test(p) || reserved.test(p)))
            throw new ObsidianError('Unsafe vault-relative path.');
        const parts = rel.split('/'), full = join(this.root, ...parts);
        const within = relative(this.root, full);
        if (within.startsWith('..') || isAbsolute(within))
            throw new ObsidianError('Path leaves vault.');
        // Check every ancestor on each access, including _learning and the vault itself.
        const chain = [dirname(this.root), this.root, ...parts.map((_p, i) => join(this.root, ...parts.slice(0, i + 1)))];
        for (const [i, p] of chain.entries()) {
            const info = lstatSync(p, { throwIfNoEntry: false });
            if (info?.isSymbolicLink())
                throw new ObsidianError('Vault path contains a symbolic link/reparse point.');
            if (info && i < chain.length - 1 && !info.isDirectory())
                throw new ObsidianError('Vault parent is not a directory.');
            if (!info && parents && i < chain.length - 1)
                mkdirSync(p);
        }
        return full;
    }
    exists(rel: string) { return !!lstatSync(this.path(rel), { throwIfNoEntry: false }); }
    read(rel: string): Buffer | null {
        const p = this.path(rel), info = lstatSync(p, { throwIfNoEntry: false });
        if (!info)
            return null;
        if (!info.isFile() || info.size > 2 * 1024 * 1024)
            throw new ObsidianError('Vault file is not a bounded regular file: ' + rel);
        return readFileSync(p);
    }
    write(rel: string, bytes: Buffer, expected: Buffer | null): boolean {
        const p = this.path(rel, true);
        const before = this.read(rel);
        if ((expected === null) !== (before === null) || (expected && before && !expected.equals(before)))
            throw new ObsidianError('File changed during sync; retry after inspecting ' + rel);
        if (before?.equals(bytes))
            return false;
        const tempRel = rel + '.tmp-' + randomUUID(), temp = this.path(tempRel, true);
        try {
            this.io.write(temp, bytes);
            const fresh = this.read(rel);
            if ((before === null) !== (fresh === null) || (before && fresh && !before.equals(fresh)))
                throw new ObsidianError('File changed during sync: ' + rel);
            this.path(rel);
            this.io.rename(temp, p);
            return true;
        }
        finally {
            if (lstatSync(temp, { throwIfNoEntry: false }))
                unlinkSync(temp);
        }
    }
    lock<T>(run: () => T): T {
        const rel = '.learning-engine/sync.lock', p = this.path(rel, true);
        let fd: number;
        try {
            fd = openSync(p, 'wx');
        }
        catch {
            throw new ObsidianError('Vault is locked. Stop concurrent exporters; inspect .learning-engine/sync.lock after a crash.');
        }
        try {
            return run();
        }
        finally {
            closeSync(fd);
            unlinkSync(p);
        }
    }
    notes(): string[] {
        const found: string[] = [];
        const walk = (rel: string) => {
            const dir = rel ? this.path(rel) : this.root;
            if (!lstatSync(dir, { throwIfNoEntry: false }))
                return;
            for (const item of readdirSync(dir, { withFileTypes: true })) {
                if (item.name === '.learning-engine' || item.name === '.obsidian')
                    continue;
                const name = rel ? rel + '/' + item.name : item.name;
                this.path(name);
                if (item.isDirectory())
                    walk(name);
                else if (item.name.endsWith('.md'))
                    found.push(name);
                if (found.length > 10000)
                    throw new ObsidianError('Vault recovery limit exceeded.');
            }
        };
        walk('');
        return found.sort();
    }
}
