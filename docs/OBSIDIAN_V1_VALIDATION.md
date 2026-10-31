# V1.1-O1 Obsidian workspace validation

Core V1 baseline: `cf8e4de1fe90e3f44c747e4dffbeb039c6c0af80`.

This is the original O1 development-checkpoint report. The detailed operational documentation now lives in [USAGE.md](USAGE.md); the [README](../README.md) provides the current portfolio overview. The review patch described below is a local development artifact and is intentionally excluded from the public repository. Subsequent portfolio preparation also extends `.gitignore`.

O1 is the explicitly authorized first post-Core-V1 feature. It remains uncommitted for external review. It adds a one-way private knowledge/study workspace, not a replacement learner database or a new learning policy.

## Environment and gates

Tested on Windows x64, Node 24.19.0, npm 11.17.0, TypeScript 6.0.3, SQLite 3.53.3 and pinned Pi coding-agent 1.0.1. No Linux/macOS runtime verification is claimed.

`npm run check` runs strict TypeScript and **332 tests: 332 passed, 0 failed, 0 skipped, 0 cancelled**. All 304 approved Core V1 tests remain active and unchanged. O1 adds 28 tests in three focused files. Local atomic-rename, junction and loopback fixtures require host permissions outside the restrictive sandbox; no live provider, private PDF or internet access is required by the portable suite.

`git diff --check` and new-file patch whitespace/reverse checks pass before review delivery. Package files, dependency set, TypeScript configuration, DESIGN_SPEC and migration definitions 1–9 remain unchanged. No migration 10 or new dependency exists. The existing `_learning/` ignore rule already protects the vault and acceptance copies, so `.gitignore` is unchanged.

## Architecture and authority

- `domain/obsidian.ts` holds presentation/read-model vocabulary only; `ports/obsidian.ts` defines read/propose interfaces.
- `CanonicalObsidianReader` accepts inward read-only repository capabilities. It snapshots course/active curriculum, stored M7 revisions/history, M8 items, exact source/research metadata and M5/M6 session metadata. M4 response bodies, scoring keys and M6 hint/explanation bodies do not enter the exported model. Session assistance/outcomes are reduced from read-only M4 metadata.
- The existing SQLite store gains one small `readSnapshot` wrapper: a synchronous transaction with SQLite `query_only` enabled temporarily, restoring its previous setting even on failure. Export tests prove attempted writes fail inside it and ordinary application writes work afterwards.
- `exports/obsidian` owns rendering, private manifest management and confined filesystem writes. It imports no SQLite driver or canonical mutation service. Pi registers `/obsidian` and delegates; it contains no SQL. Construction is lazy so a problematic vault does not prevent ordinary learning services from starting.
- Stored learner-state and review data are projected as-of their existing snapshots. Sync never invokes state refresh, review reconciliation, task submission/evaluation, curriculum activation or source mutation. A course without a stored M7 revision is labeled honestly rather than assigned fabricated competence.
- `ObsidianStudyMaterialGenerator` is an optional proposal port. Its Pi implementation reuses bounded M6 grounding, has one isolated proposal tool and no filesystem, shell, arbitrary HTTP, MCP, extensions, skills, source/SQL/evidence/state/scheduler writer. No new research occurs.

SQLite remains canonical. Markdown metadata/USER edits never enter M4/M7/M8. Sync creates no performance evidence, closes no gap and completes no review. Study material is labeled grounded synthesis, never source truth, learner knowledge or mastery evidence.

## Vault and manifest

Default private location: `<project>/_learning/obsidian-vault`.

```text
Home.md
.learning-engine/
  manifest.json
  sync.lock                     only while a writer owns the lock
Courses/<stable-readable-course-folder>/
  Dashboard.md
  Concepts/<readable-title--stable-id>.md
  Sources/<source-version-or-research-reference>.md
  Gaps/<stable-gap-note>.md
  Sessions/
    Diagnostics/<session-id>.md
    Teaching/<session-id>.md
  Review Queue.md
```

No `.obsidian` configuration bundle, plugin, OS launcher, watcher or custom graph renderer is created. The user opens the folder using Obsidian's Open folder as vault and native Graph View follows the wiki links.

The private `obsidian-workspace-v1` manifest stores course/note mappings, aliases, generated hashes, last successful sync and `grounded-study-v1` material/cache fingerprints. It is derived presentation metadata, not canonical evidence. Sync exports only the explicitly selected course; Home preserves previous exported-course summaries marked as last exported snapshots.

Readable, bounded filenames have stable ID suffixes. Invalid Windows characters, devices, trailing dots/spaces, traversal, absolute/drive paths, case collisions and Unicode are covered. Renaming a stable course/concept updates presentation/aliases without moving mapped files. Removed concepts retain their paths and USER annotations with an inactive/historical label. Prerequisites determine deterministic index order; non-prerequisite cycles are rendered normally.

After manifest deletion, valid managed-note frontmatter/markers conservatively restore identity/path mappings. Unrelated personal Markdown is ignored and left untouched. Ambiguous/malformed managed identities refuse recovery. Material may require explicit regeneration after manifest/cache loss; no canonical learning data is inferred from note metadata.

## Content and user ownership

Each generated note has generated JSON-quoted YAML frontmatter, then exactly one ordered pair of GENERATED markers and USER markers. Frontmatter uses simple scalar/array values without a YAML dependency. Generated text is escaped so source/model labels cannot inject executable HTML, ownership markers or wiki-link destinations.

Concept notes include M3 summary, optional labeled material, prerequisites/dependents/all relationship types, exact typed source anchors, separate research provenance, stored stage/dimensions, missing evidence, delayed verification, gaps, review dates and actual supported Pi practice commands. Source indexes contain IDs/versions/status/path/hash/anchors without full source duplication. Research indexes retain title/publisher/URL/retrieval/authority metadata.

Dashboard/Home use categorical counts, not a mastery percentage. Gap notes retain lifecycle, recurrence and trigger/repair/verification IDs; verified-closed and historical beliefs remain inspectable. Review Queue groups bounded overdue/due/upcoming intent and repair-needed concepts; overdue never means forgotten. Diagnostic/teaching notes show concepts, moves/scaffold support, actual assistance/outcomes and evidence IDs without response bodies. Session notes have the same preserved reflection region.

A critical test writes substantial CRLF Markdown containing code fences, wiki links, YAML-looking text, Unicode and HTML comments to USER. Canonical state/curriculum changes and later sync preserve its exact bytes. A separate test edits mastery frontmatter and writes “I mastered this”: SQLite table snapshots remain unchanged. Newline-sensitive metadata and invalid UTF-8 are checked. Missing/duplicate/misordered ownership markers cause a conflict and preserve the original file.

## Filesystem safety and recovery

Every access checks vault containment and existing ancestors for symlinks/reparse points. Root and nested Windows junction escape tests leave outside files untouched. Stable mapped paths are checked for ownership and case collisions. Personal files at a managed destination are not silently claimed or overwritten.

Sync preflights owned-note structure, computes generated hashes, avoids identical rewrites, writes complete exclusive temporary siblings and renames each into place. It rechecks expected file bytes before replacement to catch ordinary concurrent edits. The manifest publishes last. A short exclusive private lock prevents concurrent exporters; a stale crash lock requires inspection with writers stopped rather than automatic deletion.

Injected note-write/rename failures keep that original note and USER bytes. Manifest failures preserve the previous manifest; successful earlier file replacements may remain newer. Retry reconciles those derived files safely. This is **per-file atomic replacement, not an all-files transaction**. No claim is made about arbitrary storage hardware failure, fsync durability or a hostile local process racing filesystem entries. Back up USER annotations; they have no SQLite copy.

## Enrichment and model boundary

`/obsidian init|sync|status|path` require no model. Sync requires the selected course and an active curriculum. Enrichment is explicit with `/obsidian enrich <concept-id>` or `/obsidian enrich all`. Enrich-all is sequential over active concepts, skips current cache entries, continues/report individual failures and retains deterministic notes. There is no automatic model spending during sync.

Proposals allow bounded optional explanation fields, key points/self-check prompts and exact approved source/research references only. Unknown course/concept/mastery/gap/evidence/schedule/tool/answer-key fields, invented provenance, excessive bounds and unsafe control markup are rejected. Hybrid model context retains approved source-first grounding; the deterministic notes still show both provenance classes separately.

Material fingerprints include stable concept, active curriculum version/presentation/type/summary, exact provenance versions/hashes and generator policy. Unrelated learner-state changes preserve current material. Changed presentation/provenance marks it stale, displays that status and retains prior material until explicit regeneration. A proposal arriving after a curriculum/grounding change is rejected before publication. Failed provider generation preserves prior deterministic notes/material and USER annotations. Self-check prompts are explicitly private, unscored study; tracked performance stays in Pi/M4.

The pinned Pi SDK test verifies exactly one active/callable tool: `propose_obsidian_study_material`, with no ambient resources. A fake model turn submits a real structured proposal without a provider call. Additional factory tests cover creation failure, exact provider/validation error preservation, successful return despite abort/disposal failures, scope closure and fake-timer timeout cleanup. Disposal is attempted; cleanup cannot replace the primary result. These tests do not establish live model explanation quality or prove every natural-language claim safe/correct.

## Portable tests

| Test group | Evidence |
| --- | --- |
| Three course modes | Real SQLite/service composition exports source-grounded/generated/hybrid notes, exact provenance and resolvable wiki targets without changing canonical tables. |
| User ownership | CRLF/Unicode/code/wiki/YAML/comment USER bytes survive state/version changes and reflection resync. Edited mastery text has no SQLite effect. |
| Idempotency | Same canonical data produces identical note/manifest bytes and stable mtimes; harmless clock advance causes no churn. |
| Identity/evolution | Duplicate/case titles, reserved/invalid/long/Unicode names, stable title changes, new concepts and retired concepts preserve mappings and annotations. Course-folder rename and manifest recovery are covered. |
| Graph | Actual prerequisite A→B plus cyclic non-prerequisite relationships render with correct directions; all generated wiki targets exist. |
| State/history | All M7 stages and seven bands render literally; all four gap lifecycles, recurrence, review timing/kinds and metadata-only session summaries are covered. |
| Files/recovery | Malformed markers/UTF-8, corrupt/traversal/colliding manifest mappings, changed-file races, locks, write/rename/manifest failures and retry are covered. |
| Material/cache | Valid/rejected proposals, unchanged cache reuse, unrelated state, stale presentation, explicit regeneration, sequential mixed-success enrich-all and stale model result rejection. |
| Pi/offline | Actual pinned SDK loads `/obsidian`; init/path/status/sync work with empty isolated authentication, enforce course selection and make no model conversation. Injected enrichment uses its proposal port. |
| Architecture | Existing inward/no-SQL/no-runtime-cycle tests remain active. New checks prohibit export-to-core cycles, export SQLite/mutation/host-launch imports and study-generator mutation dependencies. |

## Isolated private acceptance

`scripts/validate-obsidian.ts <historical-workspace> <course-id> <logic|python>` takes a read-only SQLite backup into ignored `_learning/obsidian-acceptance/`. The originals are not opened for writing. It uses existing M9 synthetic-development histories, stored real course provenance and a clearly labeled fake material provider; no new retrieval or real learner performance is added.

| Structural result | Logic | Generated Python |
| --- | --- | --- |
| Active concept notes | 24 | 15 |
| Resolvable generated wiki links | 309 | 143 |
| Learner source references | 46, with physical PDF page anchors | 0 |
| Stored research references | 0 | 23 |
| Stored synthetic gaps | 2 | 2 |
| Stored review items/history | 5 | 4 |
| Diagnostic / teaching session notes | 1 / 1 | 1 / 1 |
| Fake material proposals accepted | 24 | 15 |
| Annotated sampled notes preserved | 3 / 3 | 3 / 3 |

Home, Dashboard, concept graph, provenance, state/missing evidence, gaps, reviews and session summaries exist. All generated wiki links resolve to mapped files. Three representative notes per course preserve synthetic personal annotations after enrichment/resync. Unchanged repeat sync writes zero notes and preserves manifest bytes. Both original input and copied canonical database SHA-256 remain unchanged; FK health passes. No source file is opened for writing.

Logic sampling uses existing graph structure/titles to seek a foundation/root, implication-related and entailment/deduction-related concept, with distinct existing-node fallbacks. The fake provider passes bounded real evidence through the proposal boundary, preserving symbols and exact anchors. **This is structural/provenance acceptance, not validated Logic/Python teaching or a claim about the real learner.** No live-provider quality run was performed.

The first-use navigation path is structurally verified as Home→Dashboard→concepts→relationships/provenance/state/gaps/reviews→personal annotation→resync. Obsidian was not launched, in accordance with the no-auto-launch requirement. Native Obsidian UI interaction, Graph View appearance and live-provider explanation quality remain manual acceptance checks; they are not claimed as completed here. Private vault paths/reports/content remain ignored rather than embedded in this public report.

## Privacy, backup and review artifact

The actual vault, manifest/cache, personal notes, generated study explanations and acceptance copies are private. No real vault, source excerpts, learner answers/state/gaps, provider transcript, generated private material, database/report/log or runtime/cache/node_modules directory belongs in the review diff. Public fixtures are explicitly synthetic. Enrichment may send bounded course evidence to the configured cloud provider; it never reads USER text into the tutor/model. Sync itself is local and deterministic. No provider credentials are stored in the vault by this feature.

README documents opening the folder, commands, ownership conflicts, stale material, cloud disclosure, stopped-writer backup of learning.db plus the vault and original sources, and the absence of a canonical copy of USER annotations. No Obsidian plugin, two-way import, watcher, web research or automatic launch exists.

`obsidian-v1-review.diff` contains the complete O1 change relative to the Core V1 baseline: **22 files, 5 modified and 17 new**. All untracked implementation files are included. The patch is checked against the exact public inventory below, reverse-checked against the working tree, whitespace-checked and scanned for private source excerpts/filenames, private generated prompts and credential patterns. Normal generic documentation references to `_learning/` are intentional; actual vault/acceptance contents are excluded. Nothing is staged or committed.

## Complete review inventory

```text
M .pi/extensions/index.ts
M README.md
M docs/APPROVED_DECISIONS.md
M src/persistence/database.ts
M src/runtime/pi/register-health.ts
A docs/OBSIDIAN_V1_VALIDATION.md
A scripts/validate-obsidian.ts
A src/domain/obsidian.ts
A src/ports/obsidian.ts
A src/services/obsidian-projection-reader.ts
A src/services/obsidian-study-material.ts
A src/exports/obsidian/obsidian-export-service.ts
A src/exports/obsidian/obsidian-manifest.ts
A src/exports/obsidian/obsidian-notes.ts
A src/exports/obsidian/obsidian-paths.ts
A src/exports/obsidian/obsidian-renderer.ts
A src/runtime/pi/obsidian-study-generator.ts
A src/runtime/pi/register-obsidian.ts
A tests/helpers/obsidian-fixtures.ts
A tests/obsidian-workspace.test.ts
A tests/obsidian-security.test.ts
A tests/obsidian-pi.test.ts
```
