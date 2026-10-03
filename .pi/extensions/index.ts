import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { openLearningDatabase } from '../../src/persistence/database.ts';
import type { SqliteFoundationStore } from '../../src/persistence/database.ts';
import { FoundationService } from '../../src/services/foundation-service.ts';
import { registerLearningStatus } from '../../src/runtime/pi/register-status.ts';

/** Composition root only: construct adapters and bind the session lifecycle. */
export default function learningFoundation(pi: ExtensionAPI): void {
  let store: SqliteFoundationStore | undefined;
  let service: FoundationService | undefined;

  const close = (): void => {
    store?.close();
    store = undefined;
    service = undefined;
  };

  pi.on('session_start', (_event, ctx) => {
    close();
    store = openLearningDatabase(ctx.cwd);
    service = new FoundationService(store);
  });
  pi.on('session_shutdown', close);
  registerLearningStatus(pi, () => {
    if (!service) throw new Error('Learning foundation session has not started.');
    return service;
  });
}
