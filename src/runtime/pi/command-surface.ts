import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export const commandOutputLimit = 32768;
/** Bound only explicit command notifications, never ordinary conversation or persisted data. */
export function commandSurface(pi: Pick<ExtensionAPI, 'registerCommand'>): Pick<ExtensionAPI, 'registerCommand'> {
    const names = new Set<string>();
    return { registerCommand(name, command) {
            if (names.has(name))
                throw new Error('Duplicate learning command registration: ' + name);
            names.add(name);
            pi.registerCommand(name, { ...command, handler: async (args, ctx) => {
                    const view = Object.create(ctx) as typeof ctx;
                    const ui = Object.create(ctx.ui) as typeof ctx.ui;
                    ui.notify = (message, kind) => ctx.ui.notify(message.length <= commandOutputLimit ? message
                        : message.slice(0, commandOutputLimit) + '\n[Display bounded; inspect a specific ID for details. Stored records are unchanged.]', kind);
                    Object.defineProperty(view, 'ui', { value: ui });
                    await command.handler(args, view);
                } });
        } };
}
export function listWindow<T>(rows: readonly T[], limit = 20): readonly T[] { return rows.slice(0, limit); }
