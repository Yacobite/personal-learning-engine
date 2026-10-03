# M4 validation — assessment and evidence foundation

Baseline: approved M3 checkpoint `3d3cb7221f984ecf26fa7d4917865ab4bcfc1209`. M4 remains uncommitted for external review. DESIGN_SPEC, package files and migrations 1–4 are unchanged.

## Pipeline and boundaries

`AssessmentService` creates immutable course/curriculum/concept task snapshots and records supplied responses. `EvaluationService` invokes an evaluator or accepts a trusted manual proposal, validates bounded outcomes, and writes evaluation/evidence atomically. `EvidenceService` exposes audits. The combined repository keeps transaction responsibility in SQLite; evaluators import only inward contracts and cannot write persistence. Pi only delegates read-only audit commands using its session's active course.

Attempts preserve confidence separately from correctness, assistance separately from novelty, and historical curriculum/targets through their immutable task. Evidence audit reconstructs the original task, response, hint metadata, scoring specification/rubric, evaluator identity/policy, rationale, timestamps and exact provenance links. Source bodies are not copied into evidence. All four identity types use lowercase UUID v4 prefixes.

Scored evaluations carry correctness in 0–1. Partial correctness requires an explicit task-specific rubric and complete criterion scores. Unscored outcomes have null correctness and no rubric scores; their events are explicitly unscored. Failed invocations preserve a failed evaluation and the original attempt, with no event. A new operation ID permits a later evaluation; retrying the same ID returns the original result. Correction links retain all prior outcomes and events. Terminal heads expose lineage without selecting an authoritative evaluation.

Migration 5 adds eight tables: `assessment_tasks`, `task_concepts`, `task_source_provenance`, `task_research_provenance`, `assessment_attempts`, `assessment_evaluations`, `evaluation_rubric_scores`, `evidence_events`. Foreign keys enforce course/version/concept/source alignment and same-attempt evaluation lineage. Snapshot mappings and rubric rows insert before their parent with deferred foreign keys; parent insertion seals them against later additions. Update/delete triggers preserve history. Task snapshots commit with all mappings; attempts commit independently before evaluation; evaluation and event commit together.

## Portable validation

Final `npm run check`: strict typecheck and **115 tests passed, 0 failed, 0 cancelled, 0 skipped**. `git diff --check` passed. The 26 new tests cover:

- All identity types, task taxonomy/dimensions/representation/novelty, explicit assistance, confidence/latency bounds, unknown fields, dangerous rubric keys and partial scoring.
- Text normalization, known choices, finite whole-response numeric parsing/tolerance boundaries, set ordering/duplicate policy, malformed answers and open explanation deferral.
- Immutable history/restart, persistent submission/evaluation idempotency and changed-payload conflicts, failure/retry, correction heads, old curriculum membership, course isolation and exact provenance.
- Mid-write task/attempt/evaluation/evidence rollback, sealed child metadata, append-only records, missing/cross-attempt evidence and lineage rejection.
- Host-independent services with fake ports and a hostile evaluator mutating only its detached input; invalid proposals cannot retarget metadata or create evidence.

The existing real pinned Pi SDK integration test now also loads `/attempt` and `/evidence`, rejects reads without an active course, runs show/evaluation/concept/recent audits and verifies audit persistence after session restart. It makes no model conversation or credential request. The AST boundary test now includes evaluator modules. Existing M0–M3 tests remain included.

Migration-history regression pins the approved four checksums and upgrades a populated schema-4 fixture while retaining prior ledger rows and course data. Historical graph/source preservation remains covered by existing graph/source tests and the real structural acceptance backup below.

## Isolated Logic structural acceptance

Command:

```powershell
node scripts/validate-assessment.ts '_learning/m3-acceptance/run-OZnCuD' course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a
```

The harness opens the approved M3 acceptance database read-only and uses Node's SQLite backup API to create a fresh ignored workspace. It does not migrate or write the original. The original database SHA-256 was unchanged after the run. No private extracted text or source question is used to invent a learner response.

**All performance data is synthetic.** The prompt explicitly says to type the development token `alpha` and states that it does not assess the linked Logic concept. A real existing concept supplies structural linkage only:

- Course `course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a`.
- Concept `concept-0e6d94b2-f679-4cf1-9d59-25dccc6f5289`, present in historical curriculum v1.
- Provenance: `source-cbbee22c-0019-4e44-9ad1-79e5cd372707`, source v1, exact segment `source-cbbee22c-0019-4e44-9ad1-79e5cd372707@1:40` (physical PDF page 41).

The complete path passed: existing course → active curriculum v1 → existing concept → task snapshot → synthetic response → deterministic evaluation → evidence audit → reopen → identical immutable history. Guided and independent attempts remained distinct. An injected evaluator failure retained the same attempt without an event; a later evaluation succeeded. A deliberately revised synthetic manual grade appended a correction without deleting the deterministic evaluation. Activation of curriculum v2 left the original task/attempt/evidence at v1. Repeated submission reused the same attempt and changed response conflicted.

Private database copies and reports remain under `_learning/m4-acceptance/`; only sanitized structural metadata is documented here. The portable tests require neither that private database nor live networking. No real learner response, transcript, private proposal, PDF or extracted text is part of M4 source/test fixtures or the review artifact.

## Limits

There is no mastery/readiness state, gap system, review scheduler, diagnostic probing, teaching engine, question-bank lifecycle, web UI or OpenClaw. Immediate correctness is not verified mastery. Confidence is not competence. Self-report without a structured task/attempt/evaluation cannot create evidence. AI-performed responses remain explicitly identifiable. No learner-state reconciliation or authoritative grade-selection policy exists.

The open-response evaluator is a port with fake/manual validation, not a live Pi LLM adapter. A future live adapter must resolve only the task's exact provenance and label source/answer text as untrusted, without exposing unrelated learner history, credentials or future task answers. The deterministic grader does no semantic equivalence, expression parsing, proof checking or code execution. Numeric comparison uses JavaScript floating-point arithmetic with only the stated tolerance. No dependency was added.

## Complete M4 inventory

Modified:

- `.pi/extensions/index.ts`
- `README.md`
- `docs/APPROVED_DECISIONS.md`
- `src/persistence/database.ts`
- `src/persistence/migrations.ts`
- `tests/boundaries.test.ts`
- `tests/pi-integration.test.ts`

New:

- `docs/M4_VALIDATION.md`
- `scripts/validate-assessment.ts`
- `src/domain/assessment.ts`
- `src/domain/assessment-validation.ts`
- `src/evaluation/deterministic.ts`
- `src/ports/assessment-repository.ts`
- `src/ports/answer-evaluator.ts`
- `src/persistence/assessment-repository.ts`
- `src/persistence/migration-5.ts`
- `src/services/assessment-service.ts`
- `src/services/evaluation-service.ts`
- `src/services/evidence-service.ts`
- `src/runtime/pi/register-evidence.ts`
- `tests/assessment-domain.test.ts`
- `tests/assessment-pipeline.test.ts`
- `tests/assessment-service.test.ts`
- `tests/deterministic-evaluator.test.ts`
- `tests/helpers/assessment-fixtures.ts`

`m4-review.diff` is a temporary review artifact containing these 25 files relative to the exact M3 checkpoint, including all new/untracked implementation files. It excludes private material, `_learning/`, databases, transcripts, node_modules, caches and other runtime artifacts. Package files are excluded because they did not change. Nothing is staged or committed; M5 is not begun.
