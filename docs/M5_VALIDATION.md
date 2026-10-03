# M5 validation

Baseline: `476fd864b7c2bd1999400eb0f31d6a0d4ae029d7` (`feat: add assessment and evidence foundation`). M5 is uncommitted and ready for external review; M6 has not begun.

## Portable verification

`npm run check` runs strict TypeScript checking and the complete test suite. Final result: **170 tests passed, 0 failed, 0 skipped**. `git diff --check` passed. Dependencies and `DESIGN_SPEC.md` are unchanged. Migrations 1–5 retain their historical SQL/checksums; migration 6 upgrades a populated M4 database while preserving its task/attempt/evaluation/evidence audit. The external-review correction does not change migration 6.

| Required behavior | Demonstration |
| --- | --- |
| Start and curriculum snapshot | Real SQLite session creation, one active session per course, same-budget resume and different-budget rejection |
| First/next selection | Deterministic middle-depth/branch policy; direct support checks dependents, difficulty/uncertainty checks prerequisites |
| M4 attempt and evaluation/evidence | Integration tests inspect real stored M4 attempts and evidence audits for answered probes |
| Provisional findings | Independent correct/incorrect, partial, assisted, AI-performed, unscored, failed and conflicting cases |
| Different response changes next probe | Chain unit test and three distinct scripted paths on each actual curriculum |
| Branches/diamonds/multiple roots | Graph unit tests plus actual Logic branch/merge visits in ignored acceptance report |
| One pending probe | Replay and simultaneous `next` calls produce one task/probe; SQLite unique index enforces the invariant |
| Restart/resume | File-backed database reopened; outstanding probe and submission idempotency survive |
| Stopping and frontier | Coverage, bounded frontier, budget and no-eligible stops; frontier remains a set with reason codes |
| Abandonment | Records retained; status abandoned and no frontier recommendation |
| Prior evidence | Same course/version snapshot, priority only, correction-aware; no current findings or stopping coverage from prior attempts |
| Corrected evaluations | One terminal evaluation per attempt; conflicting heads uncertain; completed summary frozen as of completion |
| Assistance and AI | M4 evidence preserved; neither produces independent diagnostic support |
| Historical curriculum | v1 diagnostic completes under v1 after activating v2; new v2 session excludes v1 prior observations |
| Failure recovery | Task/probe rollback together; committed attempts/evaluations survive failed diagnostic linking and recover without duplication |
| Generator trust | Unknown control fields, retargeting, invented provenance, open rubrics, malformed proposals and obvious answer keys rejected |
| Injection and Pi boundary | Hostile source/answer strings remain data; actual pinned SDK exposes only one proposal tool, with fake model turns and no provider credentials |

Tests use entirely synthetic fixtures. No live LLM evaluator was introduced. The pinned Pi extension test exercises credential-free start/status/history/abandon/summary; a command test injects a fake generator for next/submit/audit. A separate actual-SDK generator test checks active/callable tool allowlists, isolated resources and closure after disposal. This verifies SDK integration, **not a successful live provider invocation**.

## Exact policy

Policy ID/version is `prerequisite-frontier-v1`. A single-concept, independently attempted, scored terminal evaluation with correctness 1 yields `provisionally_supported`; correctness 0 yields `provisionally_unsupported`. Assistance/hints, AI performance, partial correctness, missing/failed/unscored evaluations, multiple terminal heads and ambiguous multiple targets yield `uncertain`. Conflicting independent support/difficulty across attempts yields `mixed`. Unobserved concepts remain `not_probed`. Task type, representation, novelty, assistance, timestamps and terminal evaluation/evidence IDs remain attached to each observation. Confidence does not enter the policy.

Every attempt contributes once via its current terminal lineage. An active diagnostic reads current M4 corrections. Prior attempt IDs are frozen at start, restricted to the same course/version and sealed in SQLite. Their terminal outcomes are read while active, but only prioritize candidates. No age-based verification or long-term forgetting model is implied; timestamps are preserved. Final summaries freeze the observations and terminal IDs used at completion. Audit retains all M4 lineage/evidence links, including later corrections.

The initial selector balances weakly connected regions, prefers candidates directly suggested by eligible prior observations, then chooses near the region's middle prerequisite depth with a branching tie-break and stable IDs. After support it checks the nearest eligible dependent; after other outcomes it checks the nearest eligible prerequisite. It never repeats a concept within a session. Other branches remain eligible. A direct unsupported node whose prerequisites have direct support is a boundary; its descendants may be set aside structurally, without performance classification. Frontier completion requires every node to be directly supported or structurally bounded by such a boundary. Otherwise budget/no-eligible stops apply. Final frontier includes nonsupported roots or nodes whose direct prerequisites have support, with direct-difficulty, uncertainty or untested-prerequisite reasons. Budget exhaustion can leave a broad frontier.

### External-review correction: structural availability

`DiagnosticContextBuilder.tryBuild` returns a bounded context or `undefined` specifically when pinned provenance supplies no usable evidence. Missing concepts and repository/configuration failures still throw. Reference limits apply to collected usable evidence: six sources, or four research references when no usable source exists. There is no new retrieval.

Before ranking, the orchestrator supplies the deterministic selector with structurally probeable concept IDs. Already-probed/bounded candidates remain excluded by the existing policy. An unavailable first choice cannot deadlock `next`: another eligible concept is selected, or the diagnostic completes with `no_eligible_probe`. Unavailable concepts consume no probe, receive no task/attempt/evaluation/evidence, and stay `not_probed`; this is not a claim that they are unknown to the learner. Findings, graph closure and `prerequisite-frontier-v1` retain their approved semantics.

Provider exceptions are handled separately: they propagate without persisting a blacklist or consuming a probe, leave the session in progress, and allow the same legitimate target on retry. There is no automatic model retry loop and no new persistence subsystem.

Seven regression tests in `tests/diagnostic-availability.test.ts` demonstrate first-choice fallback, multiple unavailable candidates, clean all-unavailable completion, unchanged `not_probed` findings/no fabricated M4 records, same-target provider retry, propagated configuration errors, source/research usability filtering and hybrid source priority. Existing branch/diamond/frontier and one-pending/concurrency tests still pass.

Probe budget defaults to 6 and is limited to 1–20. Skips consume a probe but create no attempt or evidence. Generation/validation errors leave the diagnostic active and create no task; retry is explicit. Evaluator failures retain the answer and failed M4 evaluation, keep the probe pending, and allow an explicit superseding retry. Each command performs one bounded step; there is no automatic model retry loop.

## Persistence and recovery

Migration 6 adds `diagnostic_sessions`, `diagnostic_prior_attempts`, `diagnostic_probes` and `diagnostic_probe_outcomes`. Composite foreign keys preserve course/version/task/attempt/evaluation/evidence alignment. Unique indexes enforce one active diagnostic per course and one outstanding/answered probe per session. Identity, final summaries and audit links are sealed; lifecycle transitions are constrained.

The only M4 write-contract extension is an optional synchronous task-link callback invoked inside M4's existing task transaction. It makes task/probe insertion atomic without nested transactions or SQL in services. New read-only ledger queries retrieve all same-version attempts and per-attempt evidence without a truncated recent-evidence limit. Attempt and evaluation writes retain M4's existing idempotency. Diagnostic links commit separately and are recoverable; failures cannot mark a half-linked probe resolved. A pending attempt link is reconciled before navigation, retry, skip or abandon. Models run outside SQLite transactions.

## Isolated real-curriculum acceptance

Run:

```text
node scripts/validate-diagnostic.ts _learning/m3-acceptance/run-OZnCuD course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a course-229d6347-0f50-43a2-9098-bbf4056ce2f6
```

Each course/profile receives its own ignored database copied from the existing M3 checkpoint. The script inspects the actual graph before defining profiles by prerequisite depth: beginner supports depth 0, intermediate supports through half maximum depth, advanced supports all depths. Responses are explicit synthetic tokens, not real learner answers or a learner model. Every task says it is an orchestration fixture. This tests orchestration and exact provenance, **not whether the question assesses course knowledge**. No new web research occurs. The original M3 database hash is unchanged.

Both courses use curriculum v2, `prerequisite-frontier-v1`, budget 12:

| Course/profile | Concepts | Probes | Stop | Direct support / difficulty / untested | Fewer probes than full traversal |
| --- | ---: | ---: | --- | --- | ---: |
| Logic beginner | 24 | 8 | frontier_located | 3 / 5 / 16 | 16 |
| Logic intermediate | 24 | 12 | budget_exhausted | 8 / 4 / 12 | 12 |
| Logic advanced | 24 | 12 | budget_exhausted | 12 / 0 / 12 | 12 |
| Python beginner | 15 | 8 | frontier_located | 1 / 7 / 7 | 7 |
| Python intermediate | 15 | 12 | budget_exhausted | 10 / 2 / 3 | 3 |
| Python advanced | 15 | 12 | budget_exhausted | 12 / 0 / 3 | 3 |

All three paths and frontier sets differ per course. Budget-limited reductions are not proof of information efficiency. Logic has 30 prerequisite edges, 8 branching nodes and 8 merge nodes. Python has 20 prerequisite edges, 5 branching nodes and 3 merge nodes. The ignored report records actual concept IDs, branch/merge visits, selection reasons, type/representation, responses, M4 IDs, classifications and frontier recommendations. Tasks span cued recall, discrimination, prediction and procedure; representations are text and mixed. Reports/database copies remain under `_learning/m5-acceptance/`, outside the review diff.

## Limitations and scope

Closed deterministic graders cannot verify rich explanation, proofs or arbitrary code. A generated question can be malformed, factually weak or semantically leak its answer despite structural checks. These remain review concerns; no pedagogical optimality or live-provider quality is claimed. A session checks each concept at most once; alternative-representation probing of the same concept is deferred, while existing representations remain distinguishable in observations. Recommendations rely on the approved prerequisite graph and preserve uncertainty where coverage is incomplete.

No durable mastery/readiness state, gaps, review scheduling, teaching, inferred ancestor evidence, web UI or OpenClaw was added. Support remains provisional and session-specific. Confidence is not competence. AI-performed work is not independent learner evidence. Models control neither navigation nor state writes and cannot mark mastery.

## Review inventory and tree

The complete `m5-review-v2.diff` contains these 30 files, including all untracked M5 files, relative to the full M4 baseline above:

```text
.pi/extensions/index.ts
README.md
docs/APPROVED_DECISIONS.md
docs/M5_VALIDATION.md
scripts/validate-diagnostic.ts
src/domain/diagnostic.ts
src/domain/diagnostic-policy.ts
src/ports/assessment-repository.ts
src/ports/diagnostic-generator.ts
src/ports/diagnostic-ledger.ts
src/ports/diagnostic-repository.ts
src/persistence/assessment-repository.ts
src/persistence/database.ts
src/persistence/migrations.ts
src/persistence/migration-6.ts
src/persistence/diagnostic-repository.ts
src/services/assessment-service.ts
src/services/diagnostic-context.ts
src/services/diagnostic-service.ts
src/runtime/pi/diagnostic-generator.ts
src/runtime/pi/register-diagnostic.ts
tests/assessment-pipeline.test.ts
tests/boundaries.test.ts
tests/pi-integration.test.ts
tests/diagnostic-generator.test.ts
tests/diagnostic-availability.test.ts
tests/diagnostic-integration.test.ts
tests/diagnostic-pi.test.ts
tests/diagnostic-policy.test.ts
tests/helpers/diagnostic-fixtures.ts
```

Private learner PDFs, extracted text, real answers, model transcripts, credentials, acceptance reports/databases, caches and runtime/build artifacts are excluded. Both review diff files are temporary artifacts, not implementation files. Nothing was staged or committed.
