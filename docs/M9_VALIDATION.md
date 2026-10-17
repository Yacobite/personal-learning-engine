# M9 validation — integration and hardening

Approved M8 baseline: `bd9a53fd80dd3eccdb4bba3aebc02b7d77b81110`.

M9 remains uncommitted for external review. This completes the approved M0–M9 roadmap; no later milestone is started. M9 changes startup/health, explicit-command presentation, model cleanup and one repository lookup. It adds final integration/security/recovery tests and documentation. Approved pedagogy, evidence, readiness, gaps and scheduling semantics are unchanged.

## Environment and final gates

Actually tested on Windows x64, Node 24.19.0, npm 11.17.0, SQLite 3.53.3, TypeScript 6.0.3 and pinned Pi coding-agent 1.0.1. Linux/macOS were not runtime-tested.

- `npm run check`: strict TypeScript succeeds; **304 tests pass, 0 fail, 0 skip, 0 cancelled**.
- All **282 approved M0–M8 tests remain active and unchanged**. M9 adds 22 tests.
- `git diff --check`: passes. New-file patch whitespace and reverse applicability are also checked before review delivery.
- No package, lockfile, TypeScript configuration or dependency change. No migration 10. Migration definitions/SQL 1–9 remain unchanged, with all nine exact approved checksums pinned in tests.
- Main verification log and private acceptance reports remain in ignored `_learning/` paths, outside the review patch.

The full suite retains approved parser, HTTP/SSRF, evaluator, idempotency, immutable ledger, curriculum, diagnostic, teaching, state and scheduler regressions. Focused tests below add cross-system coverage rather than rewriting existing expectations.

## Construction and authority boundaries

The Pi extension is the production composition root. It opens one canonical `<project>/_learning/learning.db` through the existing path resolver, constructs repositories on one SQLite handle, then course/source/research/graph, M4 assessment/evaluation/evidence, M5 diagnostic, M6 teaching, M7 state/readiness/gap and M8 review services. Services share consistent injected time and identity factories. Shutdown closes the store and clears ephemeral selection.

`tests/helpers/system-fixtures.ts` independently composes these actual services without Pi. Portable tests exercise source-grounded, generated and hybrid flows. Source and research references remain separate; hybrid uses the approved source-first context behavior.

Existing recursive architecture tests cover the entire source tree: domain/ports/services import inward, Pi adapters contain no SQL/repository construction, and content generators cannot import performance or learner-state mutation services. M9 adds a runtime import-cycle graph check and policy clock/RNG audit. No new cycle, framework, database or connection pool is introduced.

M4 is the sole performance ledger. M7 alone interprets competence/readiness/gaps. M8 schedules observations and delegates actual performance to M4 and interpretation to M7. Models propose bounded content; they have no direct evidence, mastery, gap or schedule writer. Neither passing time nor self-report creates competence.

## Help, startup and doctor

`/learning-help` groups actual commands and explains the explicit workflow. Ordinary chat is not intercepted. `/learning-status` keeps lightweight foundation behavior. `/learning-doctor` deliberately performs SQLite `integrity_check` and `foreign_key_check`, reports supported Node/runtime and database metadata, and shows selected-course curriculum/source/resumable-session/state/review IDs or counts. No response bodies, scoring keys or source excerpts are reported.

Startup validates existing migration rows/checksums before applying pending migrations, then verifies schema version, foreign-key enforcement, FTS5 and JSON support. Unknown future versions are refused without downgrade or database deletion. Full integrity scans are deliberately excluded from ordinary startup/commands.

Doctor uses a read transaction and never refreshes learner state or reconciles schedules. Tests snapshot every canonical table to prove no writes. Synthetic FK damage yields an unhealthy result without exposing orphan identifiers or deleting rows. Historical checksum changes and injected migration failure are explicit failures; failed migration writes roll back. Ordinary state/readiness/review commands retain their existing intentional refresh semantics; doctor is separate.

Explicit-command notifications have a 32,768-character display bound with a truncation notice; normal lists/histories use small windows. Stored records are untouched. Duplicate command registration is rejected. Review identity lookup now uses a bound direct query instead of reading the entire course history.

## Recovery and replay matrix

| Boundary | Existing trusted behavior and final evidence |
| --- | --- |
| Source extraction → version | Explicit failed/unsupported/incomplete/transcript-unavailable states remain unsuitable grounding. Existing M2 parser/source regressions remain active. Originals stay read-only. |
| Research → curriculum proposal | Bounded evidence capability; proposal validation precedes draft creation; activation remains explicit. Existing curriculum capability/provider/rollback tests remain active. |
| Diagnostic selection → model → M4 task → probe | Generation is outside the transaction; task plus probe link is atomic. Provider failure consumes no probe/budget and does not blacklist a concept. Concurrent/replayed next retains one outstanding probe. `diagnostic-integration` and new combined replay tests verify restart and link rollback/replay. |
| Teaching decision → content/M4 task → move | Atomic task/move insertion and revision checks; stale concurrent result rejected. Failed generation creates no move. Existing M4 operations recover post-attempt link failure. `teaching-integration` and combined replay verify outstanding-task restart and failed-evaluator retry of the same attempt. |
| Review selection → model → task/link | Generation outside transaction; immutable task and review link commit together. New M4 evidence during generation rejects the stale proposal. Concurrent next leaves one authoritative active task. `review-recovery` plus combined replay retain these checks. |
| Attempt → evaluation → evidence | Attempt persists before evaluator invocation. Failed evaluation has no evidence. Explicit retry retains the same attempt and appends evaluation lineage. Evaluation/evidence commit atomically; operation replay cannot overwrite a changed answer. Existing M4 tests and combined replay check counts/IDs. |
| M4 evidence → M7 | A failed refresh preserves previous revision/pointer and M4 history. Next explicit state/readiness/review operation can recompute deterministically. `learner-state-integration` rollback and `review-recovery` M7-failure tests remain active. |
| M7 → M8 reconciliation | Atomic schedule writes preserve old schedule on failure; next review operation reconciles. Completed outcome links survive M7 failure. `review-recovery` checks injected schedule failure, supersession rollback and retry without duplicates. |
| Evaluation correction | Attempts, old grades, evidence, state revisions and completed reviews remain immutable. New terminal lineage changes current state and future reconciliation. New cross-system correction test plus existing review-correction tests verify the cascade. |
| Gap recurrence | Actual M4 failure → repair → awaiting → delayed closure → later failure creates linked recurrence and supersedes stale maintenance. New cross-system recurrence test uses real M4/M7/M8 services. |
| Restart/reopen | New combined replay test reopens populated schema 9 with course/source/curriculum/diagnostic/teaching/evidence/state/gaps/review history and verifies complete audit snapshots, FK health and idempotent refresh. Pending teaching/review failed evaluations retain the same attempts. |
| Irrecoverable state | Startup/doctor report an error; no reset, guessed answer, fabricated evaluation, deletion or automatic corruption repair. |

Existing representative populated upgrades cover schema 5→6, 6→7, 7→8 and 8→9; fresh startup applies all nine. The schema-8 upgrade fixture retains populated course/source/curriculum/M4/M5/M6/M7 audit. The new populated schema-nine reopen test additionally retains review history. Future-schema and failed-migration cases use isolated synthetic databases only.

## End-to-end and security evidence

- Three portable full paths: source/research → activated curriculum → diagnostic frontier → teaching difficulty/scaffold/independent follow-up → M4 → M7 provisional state/gap → delayed verification → durability → maintenance → audit. Each uses restart and actual SQLite services.
- Rich teach-back remains unscored and cannot fill structural understanding. Explicit synthetic M4 closed checks supply missing required dimensions; no semantic grader is fabricated.
- Assistance remains actual M4 metadata; guided/minimal work cannot become independent competence or gap verification. Existing actual M6 hint integration remains active. AI-performed work is preserved in the ledger and excluded from M7 competence/gap closure and M8 spacing advancement. Existing M7/M8 AI/assistance/partial/unscored regressions remain active.
- Source v2 ingestion alone does not retarget curriculum v1 or evidence. Activating v2 preserves active diagnostic/teaching v1 and frozen M4 source-version references. Existing review curriculum tests verify explicit stable reuse versus new IDs inheriting nothing.
- High-level replay covers diagnostic/teaching/review selection, attempt/evaluation identity, repeated state/review refresh and stable gap/item histories. Existing representative UUID collision tests remain active; collisions do not overwrite history.
- Source and learner-response injection fixtures explicitly request shell execution, correct grades, mastery, gap deletion and 60-day reviews. They remain content. Trusted evaluation/state/spacing ignore those directives. Diagnostic/teaching/review validators reject all ten tested forbidden control fields; existing curriculum proposal tests preserve explicit activation/provenance boundaries.
- One joint capability test captures the actual four adapter session configurations: curriculum `read_curriculum_evidence` + `propose_curriculum`; diagnostic `propose_diagnostic_task`; teaching `propose_teaching_content`; review `propose_review_task`. No ambient tools/extensions/context files are loaded. Capabilities close on session-creation failure and late tools fail. Final abort and synchronous disposal are best-effort: both are attempted when a session exists, and cleanup exceptions cannot override a successful result or the primary provider/generation/validation/timeout error. Existing SDK tests retain successful-load and proposal-path coverage.
- Actual pinned Pi loads all fourteen command names without credentials and exercises local inspection, state, gaps, queue, help and doctor. Doctor remains read-only after normal workflow reconciliation. Authentication for the test is an isolated empty store, not a copied user credential.
- Two project roots with spaces retain independent course/evidence/state/review data and ephemeral selection. New path tests reject internal directory junctions and a reparse point at the database path. Existing M2 tests retain traversal, drive/case/separator and source-link safety.
- Production SQL audit found dynamic values parameterized. The learner-state repository's internal table-name selection uses fixed code-owned literals; no learner/model input becomes an SQL identifier. No production console logging or environment-secret persistence was added. Credential-bearing source/research URLs remain rejected.
- Existing official-doc tests retain HTTPS, host, credentials, IP/private/link-local, redirects, DNS/connection pinning, body limits and timeout protection. Request abort/redirect/body cleanup was inspected without broadening the approved hosts. Local test HTTP fixtures do not weaken production restrictions.
- A 121-observation synthetic history verifies deterministic state/timeline, review identity and idempotent reconciliation without timing thresholds. This is a correctness sample, not a large-dataset performance guarantee. Timeline prefix replay remains a possible future optimization for substantially larger histories.
- Evidence→task/attempt/evaluation, pinned state revision, gap history and completed review links remain auditable. Stable-basis audit/doctor operations leave table snapshots unchanged. Normal state/review operations may intentionally publish an already-approved refreshed projection when evidence changes.

## Private Logic and generated Python acceptance

`node scripts/validate-system.ts <historical-workspace> <course-id> [logic|python]` uses SQLite read-only backup into ignored isolated workspaces. It never opens the historical input for writing. It performs no new network research. Original database SHA-256 and historical migration rows remain unchanged. Source files are not opened for writing; existing stored versions, segment anchors and research references supply provenance.

Both final runs pass using the existing private Logic source-grounded course and generated Python course with stored official research. Reports, databases, private graph/source details and every synthetic performance record stay ignored. No private content or artifact-specific paths are reproduced here.

Both demonstrate diagnostic restart/provider failure/retry, adaptive frontier, teaching from that frontier, initial difficulty, scaffold, independent follow-up, retained failed evaluator response plus restart/retry, explicit missing-profile M4 checks, M7 provisional state/awaiting gap, hard delayed gate, review resume, delayed success, justified durable state, maintenance schedule, maintenance success and evidence/provenance audit. The harness respects the real multi-concept queue order rather than assuming the selected concept always comes first.

Separate copied branches demonstrate (a) an actual wrong maintenance answer with scored M4 failure, M7 downgrade/OPEN gap and no restoration from clock advance alone, and (b) correction of a previous maintenance evaluation causing stale future maintenance supersession. The successful branch remains intact. Portable tests additionally prove gap recurrence after verified closure and correction lineage preservation.

**ALL PERFORMANCE IS SYNTHETIC DEVELOPMENT DATA.** The M9 token tasks are intentionally transparent integration fixtures, not validated Logic/Python subject assessments. Actual private course structure/provenance is used, but these results establish orchestration, provenance, persistence and recovery only. They make no claim about real learner ability, live generated-task correctness, content quality or pedagogical optimality. Prior meaningful private-content acceptance remains documented in earlier milestones; it is not represented as a live provider run here.

## Public-only clean-copy verification

A temporary ignored Windows copy was built from Git-tracked public files plus untracked M9 implementation files, excluding `.git`, `_learning/`, learner sources, PDFs, runtime databases/reports, transcripts, credentials, caches, dependencies and review patches. It initially contained 186 public files (before this final validation document). No private files were copied. The copy uses the same locked dependency set.

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeds, 132 installed packages; install scripts disabled.
- `npm run check`: strict TypeScript succeeds; **304 passed, 0 failed, 0 skipped**.
- No live provider call, private PDF or external documentation service is required for tests. Synthetic loopback HTTP and Windows filesystem/junction fixtures need ordinary host permissions; they were run outside the restrictive sandbox as permitted by the handoff.
- Main and copy lockfile SHA-256 remain identical and unchanged. Final public source/doc synchronization and typecheck are checked before review delivery.

## Privacy and review artifact

The final review artifact is `m9-review-v2.diff`, relative specifically to the approved M8 baseline above. It includes all 29 M9 files: 15 modified and 14 new. No staging or commit is performed. Package files and migrations are excluded because they are unchanged.

Tracked-file and review-manifest audits reject private/runtime paths and artifacts. Final patch inspection checks private source filename/excerpt matches, private generated-question prompt matches and common credential patterns without printing private content. Public synthetic fixtures carry explicit labels. `_learning/`, private source files, acceptance reports/databases, model transcripts, node_modules, caches, logs, clean-copy contents and the patch itself are excluded. Normal generic documentation references to `_learning/learning.db` remain appropriate.

The patch is verified by reverse-check against the working tree and by matching every represented file to the complete public M9 manifest. No untracked M9 implementation file is omitted. Nothing private is staged or committed.

## Targeted external-review cleanup correction

Correction scope: the four existing model adapters, their M9 security/cleanup tests and this document only. No schemas, tool allowlists, timeout durations, persistence rules, activation behavior or M0–M8 domain policies change.

Pi 1.0.1's installed AgentSession.dispose implementation is synchronous listener/resource cleanup. Each adapter closes its proposal capability first, clears its timer, attempts abort, and independently attempts dispose even if abort fails. Cleanup exceptions are contained so already-created durable work stays successful and the primary operation error retains its identity. This is best-effort cleanup, not a guarantee that arbitrary provider/resource failures cannot happen.

The strengthened/new cleanup regressions in tests/system-security.test.ts prove:

- All four session-creation failures retain the exact original error, close every captured tool, avoid undefined-session cleanup and create no new draft/performance record. Provider failure plus abort failure preserves the exact provider Error object/message; dispose is attempted. The same check covers disposal throwing too.
- Diagnostic, teaching and review each submit a valid proposal successfully while final abort throws. The returned proposal remains valid and every capability closes. Both successful and throwing disposal variants are exercised.
- The curriculum regression invokes the real SQLite-backed GraphService.createDraft exactly once, returns that already-created draft despite abort/disposal failures, leaves the previous active version unchanged and the new version unactivated, and verifies no late tool call or retry creates a duplicate version. This specifically prevents cleanup from falsely reporting a committed draft as failed.
- All four three-minute timeout paths use Node's fake timers rather than real waiting. Timeout-triggered abort and final abort both reject, disposal is attempted, tools close and the exact intended timeout message survives even when disposal also throws.

Final working-tree and synchronized public-copy gates both retain all 282 approved regressions: **304 tests passed, 0 failed, 0 skipped**. The old temporary review diff is removed; the complete v2 diff remains relative to the same approved M8 baseline.

## Known limits

No live cloud-provider generation was required or claimed. Structural content validation cannot prove semantic correctness, detect every answer leak or guarantee genuinely changed-context questions. Rich responses remain unscored by default. Spacing is the unchanged deterministic ladder, not official FSRS. Doctor detects faults but cannot repair them or prove all historical semantic relationships from aggregate health metadata. Filesystem checks do not defend against a hostile local process racing path replacement. Manual backups require stopped writers; no backup service is introduced. Very large histories and non-Windows runtime behavior need further measurements/verification.

No migration 10, dependency, new pedagogy, web UI, question bank, notification/background service, arbitrary web researcher, global learner model, OpenClaw or later-milestone implementation exists. The existing explicit supplied-URL ingestion boundary remains distinct from the restricted generated-course research adapter.

## Complete M9 inventory

`M` = modified since approved M8; `A` = new, untracked M9 file. The review diff itself is a temporary artifact, not an implementation file.

```text
A docs/M9_VALIDATION.md
A scripts/validate-system.ts
A src/domain/health.ts
A src/persistence/database-health.ts
A src/ports/health-store.ts
A src/runtime/pi/command-surface.ts
A src/runtime/pi/register-health.ts
A src/services/health-service.ts
A tests/health-hardening.test.ts
A tests/helpers/system-fixtures.ts
A tests/system-integration.test.ts
A tests/system-pi.test.ts
A tests/system-recovery.test.ts
A tests/system-security.test.ts
M .pi/extensions/index.ts
M README.md
M docs/APPROVED_DECISIONS.md
M src/persistence/database.ts
M src/persistence/review-repository.ts
M src/runtime/pi/curriculum-builder.ts
M src/runtime/pi/diagnostic-generator.ts
M src/runtime/pi/register-course.ts
M src/runtime/pi/register-curriculum.ts
M src/runtime/pi/register-diagnostic.ts
M src/runtime/pi/register-learner-state.ts
M src/runtime/pi/register-source.ts
M src/runtime/pi/register-teaching.ts
M src/runtime/pi/review-generator.ts
M src/runtime/pi/teaching-generator.ts
```

Relevant final tree:

```text
.pi/extensions/index.ts                one production composition and command view
src/domain/health.ts                  health result vocabulary only
src/ports/health-store.ts              inward read-only inspection port
src/services/health-service.ts         health result/support checks
src/persistence/database.ts            canonical opening and lightweight startup checks
src/persistence/database-health.ts     migration/capability validation and deliberate doctor
src/persistence/review-repository.ts   bound direct review lookup
src/runtime/pi/command-surface.ts      duplicate guard and bounded explicit command notifications
src/runtime/pi/register-health.ts      help and read-only doctor
src/runtime/pi/*generator.ts           existing isolated adapters with stronger cleanup
src/runtime/pi/curriculum-builder.ts   existing bounded evidence/proposal adapter cleanup
src/runtime/pi/register-*.ts           bounded existing lists/histories
tests/health-hardening.test.ts         health, checksums, future schema, paths, command output
tests/system-integration.test.ts       three modes, evolution, correction, recurrence, scale
tests/system-recovery.test.ts          combined restart/replay and complete populated audit
tests/system-security.test.ts          joint capabilities, hostile fields, cycles and determinism
tests/system-pi.test.ts                actual pinned Pi credential-free command smoke
tests/helpers/system-fixtures.ts       synthetic non-Pi composition, source/research fixtures
scripts/validate-system.ts             explicit isolated private-course synthetic acceptance
README.md                             practical workflows, disclosure, health and manual backup
docs/APPROVED_DECISIONS.md              appended M9 choices only
docs/M9_VALIDATION.md                  this sanitized report and complete inventory
```
