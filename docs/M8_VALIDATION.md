# M8 validation — review and spacing

Approved M7 baseline: `447be5394709f7b77b2912b03bafff18e73d836c`. M8 remains uncommitted for external review. M9 has not begun.

## Verification and scope

Final npm run check: strict typecheck and **282 tests passed, 0 failed, 0 cancelled, 0 skipped**. git diff --check passed. There are 49 added tests alongside all 233 approved M0–M7 tests. Package files/dependencies and DESIGN_SPEC are unchanged. Migrations 1–8 retain their exact historical definitions/checksums; migration 9 is additive. No provider credentials or new network research are needed for portable tests. The complete suite requires local loopback HTTP and symlink-fixture permissions on this Windows environment.

## Policies and boundaries

Policies: evidence-spacing-v1, review-queue-v1, review-task-v1. This is an explicit deterministic ladder, not official FSRS. ReviewItems are intentions to obtain observations, never learner evidence. No mastery percentage, memory probability, time-based forgetting or clock-only competence mutation exists. M4 remains the sole performance ledger; M7 alone interprets competence/readiness/gap escrow. M8 cannot mark mastery or close/reopen a gap. No M7 bands, profiles, 24h rules or gap semantics change.

Candidates are M7 provisional_competence with waiting_for_delayed_evidence, gaps in AWAITING_VERIFICATION, and durable_mastery for maintenance. Delayed/gap earliest_at and due_at are the exact canonical M7 eligible-after values. OPEN/REPAIR gaps are displayed as requiring repair rather than scheduled as verification. Missing required dimensions do not become maintenance. Selection/submission never bypass earliest-at.

Maintenance stages use 3/7/14/30/60 days, capped at 60. A qualifying independent, scored-one, single-terminal-head, single-concept M4 outcome matching trusted review constraints advances exactly one stage. Current corrections remove invalid contributions without counting the same attempt twice. Assisted, AI-performed, partial, unscored or ambiguous outcomes never advance spacing; a still-relevant requirement gets another independent opportunity at least 24h after that attempt, subject to stricter M7 eligibility. Scored failure is a performed review; subsequent M7 state determines future scheduling. Loss/regain of durability resets the ladder.

The small M7 read-only competenceTimeline query replays a pinned revision's already-interpreted M4 metadata through the existing M7 policies. It returns stage transitions in attempt order under that revision's terminal heads. It does not read newer ledger rows, create identities/revisions, or reproduce mastery rules in M8. The last transition into durable mastery supplies the episode/anchor event. This handles late scheduler installation and recurrence even when intermediate projections were never published. Historical grading beliefs remain in ordinary revision history.

Required dimensions are selected by independent recency, then observation count, transfer/representation coverage and stable ties. Task mapping is cued_recall, structured error_diagnosis, discrimination, prediction, near_transfer, representation_conversion or procedure according to dimension. Calibration is never a target. Transfer requires near_transfer novelty or stronger; other targets default to isomorphic. Representations rotate text/mixed for repeated same-dimension reviews without claiming unobserved competence. Exact prompt hashes are checked against all known concept performance, including trigger/repair history; the model receives at most 100 recent hashes. No semantic duplicate detector exists.

Queue order: overdue gap, due gap, overdue delayed, due delayed, overdue maintenance, due maintenance. Within a class, greater lateness wins. Equal lateness interleaves concept, dimension, task type and representation against the last completed review, then stable concept/review IDs. Upcoming, due and overdue are derived from canonical timestamps: exactly due is due; one millisecond later is overdue. Queue display is bounded per group, default 10; explicit limits/history accept 1–50. An optional pure deadline-context hook validates input but adds no persisted deadline feature and cannot bypass eligibility.

## Storage and recovery

Migration 9 adds six tables:

- review_items: immutable scheduling identity, semantic basis, policies, origin revision/gap, target constraints, original times/stage.
- review_progress: constrained current lifecycle/task/attempt projection, with unique active and pending-basis indexes.
- review_events: append-only lifecycle, reasons, timestamps and original outcome links.
- review_outcomes: append-only M4 evaluation/evidence associations, including later corrections.
- review_reconciliations: state revision/basis audit.
- review_task_origins: immutable review_generated extension to existing M4 tasks.

M4's original origin column retains source-derived/curriculum-generated provenance; the adapter exposes review_generated when the extension exists. The historical origins array is unchanged because migration 5 imports it; current validation uses a separate extended array. No historical schema rebuild is required. Existing performed tasks cannot acquire this extension.

Foreign keys and triggers enforce course/version/concept/state/gap and task/attempt/evaluation/evidence ownership, retained history, sealed completion and one unresolved active/awaiting review per course. Item creation and reconciliation are atomic. M4 task creation plus review linking uses M4's existing synchronous callback transaction. Generation happens outside transactions and rejects stale state/version results.

Attempts commit under stable M4 operation IDs before evaluator invocation. Evaluation/evidence remains M4-owned. M8 repairs links from those operation IDs on refresh; failed evaluation remains awaiting_evaluation and explicit retry evaluates the SAME attempt. Valid outcomes link before M7 refresh. If M7 fails, evidence and original review audit survive and no new schedule advances; refresh retries recovery. If schedule publication fails, M7 remains valid and the prior valid schedule/history is rolled back intact.

Reconciliation preserves unchanged pending semantic requirements across unrelated M7 revisions. Material changes supersede future items with the causing revision ID in their event. Completed identities/constraints/dates/attempt links never change. Correction links append; current outcome reporting uses current terminal heads. v1 items are never retargeted to v2. Active-version queues generate new tasks against current provenance; compatible explicitly reused stable concepts carry maintenance history, while new IDs and changed profiles do not silently inherit it. An already answered unresolved old-version item can finish its original performance before another review becomes active.

## Pi and model security

Commands: /review, next, answer <review-id> <JSON>, retry <review-id>, status, history [1–50], show <review-id>. They use session-local active course selection and expose public task fields, not scoring keys, before submission. Rich JSON responses preserve symbols, spaces and multiline code. Optional assistance/hints record actual help; there is no review hint ladder or worked solution. Repair belongs to /teach. Self-report without an M4 performance does not complete or advance anything.

The pinned Pi 1.0.1 SDK runs the generator in a separate in-memory session with exactly propose_review_task, no ambient resources/extensions/context files/skills/MCP, shell, filesystem, web or mutation capability. The model supplies prompt, scoring and supplied provenance references only. It cannot set identity, dates, stages, dimensions, kind, assistance result, gap, mastery or evidence. Real SDK tests use a fake model turn and verify disposal/closed capabilities; no live provider completion quality is claimed.

The composition root now actually constructs M7 services alongside M8; M7 had registered its commands without constructing those services. A real extension-loading regression exercises /state and /review. No M5/M6 navigation redesign enters M8.

## Required demonstrations

| Behavior | Evidence |
| --- | --- |
| Refresh, future delayed item, hard earliest gate, due/overdue boundaries | review-integration and review-policy tests; Logic/Python A |
| Awaiting gap exact dimension/date; OPEN/REPAIR excluded; delayed closure via M7 | review-integration tests; Logic D |
| Durable → 3d; 7/14/30/60 progression and cap | review-integration tests; Logic/Python B |
| Assisted/AI/unscored no advancement; partial/ambiguous classification | integration/recovery/policy tests; Logic E |
| AI cannot satisfy delayed/gap verification | integration tests |
| Failure through M4/M7; recurrence regain resets stage zero | integration tests; Logic C |
| Overdue and self-report do not create learning evidence | integration/Pi tests; Logic F |
| Deterministic queue priority, tie-breaks and interleaving | policy tests |
| Duplicate prompt/provenance/control-field rejection and hidden-key separation | generator/integration/Pi tests |
| Structurally missing grounding falls through; all unavailable is explicit | recovery tests |
| Transient provider retry without blacklisting or fake tasks | integration tests |
| One active item, repeated next and concurrent next | integration/recovery tests |
| Restart/resume with advanced clock | recovery tests |
| Failed evaluator retries same attempt; post-write link recovery | integration/recovery tests |
| Corrected outcome reconciles future items; old completion unchanged | integration tests |
| v1/v2 history, stable-ID reuse, new IDs and profile changes | curriculum tests |
| M7 refresh failure and atomic scheduler/task-link rollback | recovery tests |
| Idempotent semantic refresh and unchanged unrelated target | policy/integration tests |
| Late installation anchors to durability event, no timeline writes | integration tests |
| New evidence during generation rejects stale proposal | recovery tests |
| Populated M7 upgrade preserves M4/M5/M6/M7 audit, gaps and all prior checksums | migration tests |
| Pure policies/inward services/no SQL in Pi/no generator mutation | boundary tests |

## Synthetic private acceptance

ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA. No claim is made about the real learner.

Run node scripts/validate-review.ts <ignored-private-reviewed-catalog.json>. The harness backs up approved M7 C/D workspaces read-only into separate ignored per-profile workspaces and upgrades only those copies. It uses the existing source-grounded Logic and generated Python curricula/research; no retrieval occurs. Reviewed private content supplies closed course-related checks, while gap-transition seed outcomes are explicitly synthetic development fixtures. Reports omit source excerpts and responses; generated prompts/scoring remain only in ignored M4 databases/catalogs.

Logic course course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a, curriculum v2, Completeness concept concept-1c338ccb-14ed-484a-a38b-773d03c66e42. Profile A starts provisional, rejects early selection, performs due independent changed-case transfer and reaches durable through M7. B rotates transfer → application → discrimination → structural understanding → memory → transfer while advancing 3/7/14/30/60/60. C records maintenance failure and M7 not_ready/open gap, with no pending maintenance. D moves OPEN → AWAITING through a synthetic repair, then a due independent memory check lets M7 verify/close and establish durability. E retains stage zero after guided success and schedules an independent opportunity 24h later. F advances the clock one year with the identical M7 revision and no new performance.

Python course course-229d6347-0f50-43a2-9098-bbf4056ce2f6, curriculum v2, Local and module scope concept concept-cd3cc67d-6eb8-4c44-a2c7-06921d654872. A/B demonstrate the same delayed check and complete maintenance ladder/rotation using stored M3 research and structured scope checks. Source-grounded and researched provenance remain distinct.

Each report preserves course/version/policy/concept, origin M7 revision/gap, earliest/due/stage, ordered queue, task type/representation/novelty, synthetic M4 IDs, state before/after and next item. Original database SHA-256 values, migration 1–8 ledger rows and all existing rows in M4/M5/M6/M7 audit tables are verified unchanged; foreign-key checks pass.

## Limits

The ladder is a transparent V1 policy, not a validated memory model. Closed structured questions can sample a dimension but do not prove rich explanatory understanding. Structural/provenance validation cannot prove factuality, prevent every semantic answer leak, or establish genuine transfer from metadata. The private reviewed tasks test orchestration and sampled content, not a live provider's general quality. No open-response semantic evaluator, proof/code executor, question bank, background notifications, forgetting model, new dependency/research, web UI, OpenClaw or M9 is implemented.

Structural availability means the runtime can resolve usable pinned evidence and an allowed closed task family; malformed/provider proposals remain explicit retryable errors, not inferred learner weakness. A permanently unavailable requirement remains superseded with its reason until its semantic basis changes.

## Complete M8 inventory

The complete review diff represents **36 files** (14 modified, 22 new) against the exact M7 baseline, including every untracked M8 source/test/fixture/script/doc. Package files are unchanged and excluded. The review diff itself is a temporary artifact outside the implementation inventory. Nothing is staged or committed.

```text
.pi/extensions/index.ts
README.md
docs/APPROVED_DECISIONS.md
docs/M8_VALIDATION.md
scripts/validate-review.ts
src/domain/assessment-validation.ts
src/domain/assessment.ts
src/domain/review-queue-policy.ts
src/domain/review-schedule-policy.ts
src/domain/review-task-policy.ts
src/domain/review.ts
src/persistence/assessment-repository.ts
src/persistence/database.ts
src/persistence/migration-9.ts
src/persistence/migrations.ts
src/persistence/review-repository.ts
src/ports/review-generator.ts
src/ports/review-repository.ts
src/runtime/pi/register-review.ts
src/runtime/pi/review-generator.ts
src/services/learner-state-service.ts
src/services/review-content.ts
src/services/review-service.ts
tests/assessment-pipeline.test.ts
tests/boundaries.test.ts
tests/diagnostic-integration.test.ts
tests/helpers/review-fixtures.ts
tests/learner-state-integration.test.ts
tests/pi-integration.test.ts
tests/review-curriculum.test.ts
tests/review-generator.test.ts
tests/review-integration.test.ts
tests/review-migration.test.ts
tests/review-pi.test.ts
tests/review-policy.test.ts
tests/review-recovery.test.ts
```

Relevant structure:

```text
.pi/extensions/index.ts               composition and existing M7 wiring
src/domain/review.ts                  identities, constraints, temporal/outcome vocabulary
src/domain/review-*-policy.ts         schedule, queue and task policy
src/ports/review-*.ts                 persistence and content generator boundaries
src/services/review-*.ts              content validation and orchestration
src/services/learner-state-service.ts read-only M7 timeline extension
src/persistence/migration-9.ts        additive schema only
src/persistence/review-repository.ts  transactional scheduling and M4 links
src/runtime/pi/*review*.ts            isolated generator and commands
tests/review-*.test.ts                policy, integration, migration, security and recovery
tests/helpers/review-fixtures.ts      synthetic portable data
scripts/validate-review.ts            explicit ignored private acceptance
docs/M8_VALIDATION.md                 sanitized validation and complete inventory
```

Final private acceptance reports: Logic _learning/m8-acceptance/run-6UFEm5/report.json; Python _learning/m8-acceptance/run-ihZnJa/report.json. All eight profiles passed. Catalogs, reports, databases, private questions/answers/source bodies, transcripts, runtime caches, dependencies and temporary artifacts are excluded from m8-review.diff. Original M7 databases remain unchanged. The full diff is checked for source-excerpt and private-catalog prompt matches and verified by reverse application against the working tree.

Explicit invariants: ReviewItems are not evidence; M8 creates no performance evidence itself, marks no mastery and closes no gap. M4 alone writes performance and M7 alone interprets learner state. AI work and self-report never advance spacing. Delayed eligibility cannot be satisfied early. Overdue is competence-neutral. There is no mastery probability, background/notification system, web research, question bank or M9 implementation.
