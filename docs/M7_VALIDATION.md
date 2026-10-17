# M7 validation

Approved M6 baseline: `c121938ebdd222fb983e2e22f4b8dbb728c5e9f7`. M7 is uncommitted for external review. M8 has not begun.

## Verification

Final portable gate: `npm run check` — **233 tests passed, 0 failed, 0 skipped**, including strict TypeScript checking. `git diff --check` passed. The suite uses synthetic material and local fixtures, without live provider credentials or new web research. Restricted-sandbox runs initially blocked loopback HTTP and symlink fixtures; the complete final suite runs with the necessary local permissions. No checks are skipped.

Migrations 1–7 retain their approved SQL/checksums. Migration 8 is the only new migration. A populated schema-7 portable test contains actual M4, M5 and M6 records; upgrade preserves the complete prior ledger and audit results. The private acceptance copies also start from populated approved M6 databases. Package files, dependencies and DESIGN_SPEC.md are unchanged. Existing M4/M5/M6 business logic is unchanged; historical tests now account for schema 8 without letting old components mutate learner projections.

## Domain and policy

Policy identifiers: evidence-state-v1, gap-escrow-v1, readiness-v1, competence-profile-v1. There is no scalar mastery percentage or probability. The user explicitly approved assisted_difficulty in addition to the original six bands.

| Band | Exact interpretation |
| --- | --- |
| untested | No qualifying scored observation for a categorical competence claim |
| assisted_only | Successful assisted scored evidence, no qualifying independent success, latest assisted result not failure |
| assisted_difficulty | Latest attributable assisted result is incorrect, without independent positive evidence; not mislabeled independent difficulty |
| independent_difficulty | Latest qualifying independent result is incorrect; assisted success cannot erase it |
| mixed | Independent support and difficulty exist, but OPEN/REPAIR escrow still blocks stable positive support |
| provisional_support | Qualifying independent success without a currently satisfied durable dimension gate |
| durable_support | A delayed independent positive check, no later independent failure and no unresolved gap for that dimension |

For strong categorical evidence, one stable target concept and one current terminal scored evaluation are required; correctness is exactly 0 or 1 and a canonical M4 evidence event must exist. Independent also requires assistance none, zero hints and highest hint none. Partial, failed, missing, unscored, AI-performed and ambiguous records remain separately reportable. Multiple terminal heads never choose a convenient grade. Multi-concept evidence remains contextual and cannot award/remove competence across all targets or create several gaps.

Only explicit task dimensions receive ordinary dimension support. Scaffold independence additionally derives observed help/independence from relevant attempts; inferred dimensions alone do not automatically manufacture gaps. Transfer positive support requires intended transfer, near_transfer/far_transfer/authentic novelty and a genuinely non-repeated case. Original M4 novelty stays in audit; reused task IDs or whitespace-normalized prompt hashes flag repeated cases separately. These checks detect exact repetition, not semantic equivalence or subtle isomorphism.

Calibration records confidence/outcome pairs and counts without changing correctness or claiming calibrated competence from answer correctness. Its categorical competence band remains untested under v1; confidence observations remain visible. It is not a readiness gate. Representations list only actual observed M4 formats; success in text never creates a symbolic/graph event. Intended dimensions and remaining novelty semantics rely on M4 task/evaluator quality; M7 does not inspect answers or run a semantic grader.

## Profiles and readiness

| Actual M3 type | Required immediate dimensions |
| --- | --- |
| concept | memory_accessibility, structural_understanding, discrimination, application, transfer |
| definition | memory_accessibility, structural_understanding, discrimination |
| procedure | structural_understanding, application, transfer, procedural_fluency, scaffold_independence |
| representation | structural_understanding, discrimination, representation_flexibility |
| boundary_case | discrimination, application, transfer |
| misconception / assessment_objective | not_applicable; no standalone competence claim |

Each required dimension needs provisional/durable independent support. OPEN/REPAIR gaps block provisional competence; AWAITING gaps can coexist with provisional competence but prevent durable mastery. Direct evidence may establish a concept's competence despite missing prerequisites, with separate prerequisite warnings. Otherwise sufficient provisional/durable direct prerequisites allow instructionally_ready; missing prerequisite evidence yields not_ready. Roots can be instructionally_ready with no evidence. Non-assessable metadata nodes do not demand an impossible competence stage. No graph edge creates learner evidence.

Durable mastery requires the complete immediate profile plus one concept-level delayed independent check on a required dimension, no later qualifying independent failure, no unresolved applicable gap and no single-concept terminal-head ambiguity affecting requirements. Each dimension does not need its own delayed test. Ambiguous multi-concept tasks do not demote established competence everywhere.

The delay constant is 86,400,000 ms. A distinct later independently successful non-repeated task must have at least isomorphic novelty. Actual attempt times determine separation, not grading time. Boundary tests cover 23h59m59s, exactly 24h and beyond. Time alone creates no new support or meaningless duplicate revision. Eligible-after is information, not a review due date. Snapshot as-of time remains explicit when unchanged evidence reuses an earlier revision.

## Gap escrow and correction history

Gap identity is immutable course/stable-concept/primary-dimension/trigger-attempt/policy plus gap UUID. Dimension attribution uses explicit task targets and intended dimensions with the transfer gate above. A scored zero from learner work can trigger a gap even with assistance. AI, partial, failed, unscored and ambiguous attribution cannot trigger it. The reason is performance_failure, without speculative misconception labels or severity scores.

Repeated failures attach to one active gap. Later assisted/same-item/insufficient success can move OPEN to REPAIR_IN_PROGRESS. An independent changed/parallel success can move OPEN or REPAIR directly to AWAITING_VERIFICATION, as M7 §93 permits. Another distinct independent non-repeated success on the same concept/dimension, at least 24h after the awaiting event, can close it. Failure resets active escrow to OPEN and clears its verification gate. A new failure after closure creates a separate linked recurrence; old closure history remains.

Current state recomputes current terminal M4 lineages in timestamp/ID order. A correction can remove an obsolete trigger or invalidate a previous repair/closure/recurrence interpretation. Immutable identity rows and old revision snapshots remain; current status can be absent rather than inventing a fifth lifecycle state. Recurrence links are revisioned because their causal interpretation can change after correction. Policy-specific identity keys cannot accidentally reuse identities from another policy.

## Architecture, storage and transactions

```text
M3 immutable graph + read-only M4 metadata ledger
    → evidence-state-policy / gap-policy / competence-profile / readiness-policy
    → LearnerStateService
    → LearnerStateRepository
    → SQLite revision snapshots and current pointer

ReadinessService / GapService
    → LearnerStateService revision APIs
    → thin Pi state/readiness/gaps commands
```

The M4 read adapter spans course history across curriculum versions and excludes response bodies, grading keys, rationale and source text. M4 remains canonical performance history. Projection snapshots store counts, derived metadata, prompt hashes and audit references. They do not create a second answer/grading ledger. Stable IDs explicitly reused in a new curriculum carry evidence; new IDs with similar titles do not. Version-specific node types change profiles without rewriting old evidence or revisions.

Migration 8 tables: learner_revisions, learner_current, learner_dimensions, learner_dimension_evidence, learner_gap_identities, learner_gap_snapshots, learner_gap_evidence, learner_readiness. SQL enum vocabularies are frozen locally to avoid future active-policy changes altering historical SQL. Foreign keys enforce course/version/concept and M4 reference ownership. Immutable update/delete triggers and parent-last sealing protect published revision children.

A short BEGIN IMMEDIATE refresh encloses the synchronous metadata read, deterministic build, identity allocation and atomic projection/current-pointer publication. No model or network calls occur. Failure rolls everything back, including new gap identities; prior current state and M4 records remain. Unchanged policy/curriculum/evidence fingerprint reuses a revision. The fingerprint includes original version, task metadata/prompt hash, assistance/hints, confidence, dimensions, novelty, representation and terminal evaluation/evidence identity/outcome. Responses, credentials and source bodies are excluded. Restart/idempotency, policy separation and injected mid-write rollback are tested.

## Required demonstrations

| Requirement | Test evidence |
| --- | --- |
| Refresh existing M4; immutable/idempotent revisions; new basis revision | learner-state-integration.test.ts |
| Corrections change current state; historical beliefs intact | gap-escrow and learner-state-integration tests |
| Stable identity reuse; new similar title isolated; profile changes | readiness-policy.test.ts |
| Every band; assistance/AI; partial/unscored/failed/ambiguous; exact ordering | learner-state-policy and integration tests |
| 24h boundary; no clock-only promotion; late grading excluded | policy, gap-escrow and integration tests |
| Root readiness; prerequisite gate; direct override; no parent inference | readiness-policy.test.ts |
| Provisional/durable/downgrade; required dimension missing | readiness-policy.test.ts and private profiles C–F |
| Open/repair/same-item rejection/parallel awaiting/delayed closure | gap-escrow.test.ts |
| Reset, deduplication, recurrence and audit history | gap-escrow.test.ts |
| Readiness missing evidence and compact course grouping | readiness service and Pi command tests |
| Restart and atomic rollback | learner-state-integration.test.ts |
| M5/M6 labels do not grant competence; actual worked support persists | learner-state-integration.test.ts |
| Self-report/confidence cannot grant competence | integration and policy tests |
| Credential-free commands; no bypass edits | learner-state-pi.test.ts |
| Pure/inward boundaries; no scheduler or model calculation | boundaries.test.ts |
| Migration 8 preserves populated M6 audit and all prior checksums | learner-state-integration.test.ts plus historical regression suite |

No new dependency, live evaluator, review scheduler, notification, question bank, teaching/diagnostic navigation, web UI or OpenClaw is included. No model participates in learner-state calculation. Immediate same-item repair cannot close a gap, AI work is not learner competence, and delayed evidence is required for durable mastery.

## Private acceptance

ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.

`node scripts/validate-learner-state.ts <M6-workspace> <course-id> [logic|python]` backs up an existing schema-7 workspace read-only into separate ignored profile workspaces. It selects a real existing concept without baseline performance; no original evidence is removed. Synthetic development rubric outcomes are recorded through real M4 services on curriculum v1 and projected onto the same stable concept in active v2. This tests the learner model, not question generation or actual user knowledge. Synthetic clocks make delay boundaries explicit. Original database hashes, prior migration ledgers and baseline M4 metadata are checked unchanged; all reports omit source excerpts.

Logic: `_learning/m7-acceptance/run-NbOEYi/report.json`. Course `course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a`, curriculum v2, concept `concept-1c338ccb-14ed-484a-a38b-773d03c66e42` (Completeness). Existing prerequisite warnings remain separate from direct competence.

| Profile | Synthetic history | Final stage / gap result |
| --- | --- | --- |
| A | Same-session independent evidence on one required dimension | not_ready; other requirements/prerequisite evidence missing; not durable |
| B | Broad guided success | not_ready; independence missing; not durable |
| C | Broad immediate independent evidence | provisional_competence; delay missing |
| D | Immediate profile plus a later changed required-dimension check at 24h | durable_mastery; no open gap |
| E | Failure → same task repair → changed case awaiting → another delayed independent case | VERIFIED_CLOSED; durable criteria satisfied |
| F | E followed by another meaningful failure | new recurrent OPEN gap; prior gap stays closed; current stage not_ready |

The report includes course/concept/profile, timestamped evidence sequence, original/current curriculum versions, dimension counts/bands, stage/gap transitions, delayed timestamps, missing requirements and supporting/contradictory M4 IDs. It states synthetic development data throughout and makes no claim about the real user.

Python: `_learning/m7-acceptance/run-JB1FLh/report.json`, existing generated course `course-229d6347-0f50-43a2-9098-bbf4056ce2f6`, v2, stable concept `concept-cd3cc67d-6eb8-4c44-a2c7-06921d654872` (Local and module scope). Profile C is provisional and D is durable under the same policies; original evidence version remains v1. No new research occurs.

## Limits

V1 is a transparent deterministic estimate, not a validated psychological model. It relies on valid M3 stable identities and M4 grading/intended-dimension/novelty metadata. Exact repetition checks do not detect all paraphrases or semantic isomorphism. Unscored rich teach-back remains missing scored structural support; no keyword hacks or live semantic evaluator are added. Broad dimension labels must reflect actual assessment intent; M7 does not infer a per-rubric semantic mapping or specific misconception. Historical/current projections are curriculum-scoped, while gap audit can retain concepts or interpretations absent from the current version. Eligibility timestamps do not enqueue any work. No automatic decay, forgetting probability or evidence weighting is introduced.

## Complete review inventory

`m7-review.diff` includes all 32 files below relative to the full approved M6 baseline, including every untracked M7 source/test/fixture/doc/script. Package files are unchanged and excluded. Private performance, gaps, responses, source material, transcripts, _learning/, reports/databases, node_modules, caches and temporary artifacts are excluded. Nothing is staged or committed.

```text
.pi/extensions/index.ts
README.md
docs/APPROVED_DECISIONS.md
docs/M7_VALIDATION.md
scripts/validate-learner-state.ts
src/domain/competence-profile.ts
src/domain/evidence-state-policy.ts
src/domain/gap-policy.ts
src/domain/learner-state.ts
src/domain/readiness-policy.ts
src/persistence/database.ts
src/persistence/learner-ledger.ts
src/persistence/learner-state-repository.ts
src/persistence/migration-8.ts
src/persistence/migrations.ts
src/ports/learner-ledger.ts
src/ports/learner-state-repository.ts
src/runtime/pi/register-learner-state.ts
src/services/gap-service.ts
src/services/learner-state-service.ts
src/services/readiness-service.ts
tests/assessment-pipeline.test.ts
tests/boundaries.test.ts
tests/diagnostic-integration.test.ts
tests/gap-escrow.test.ts
tests/helpers/learner-state-fixtures.ts
tests/learner-state-integration.test.ts
tests/learner-state-pi.test.ts
tests/learner-state-policy.test.ts
tests/pi-integration.test.ts
tests/readiness-policy.test.ts
tests/teaching-integration.test.ts
```
