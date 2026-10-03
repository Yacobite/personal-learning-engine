/** Engineering diagnostics only; this is not learner or mastery state. */
export interface FoundationStatus {
  readonly schemaVersion: number;
  readonly sqliteVersion: string;
  readonly fts5Available: boolean;
}
