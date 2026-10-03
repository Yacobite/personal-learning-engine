import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { FoundationService } from '../../services/foundation-service.ts';

/** UI adapter: invokes an application operation and presents its result. */
export function registerLearningStatus(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
  getService: () => Pick<FoundationService, 'getStatus'>,
): void {
  pi.registerCommand('learning-status', {
    description: 'Show the M0 database and runtime foundation status',
    handler: async (_args, ctx) => {
      const status = getService().getStatus();
      ctx.ui.notify(
        `Learning foundation: schema v${status.schemaVersion}; SQLite ${status.sqliteVersion}; `
        + `FTS5 ${status.fts5Available ? 'available' : 'unavailable'}.`,
        'info',
      );
    },
  });
}
