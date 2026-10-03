# M6 validation

Approved M5 baseline: `a34a02ecb03e2d8abc734f313c837a31b8c136f0`. M6 remains uncommitted; M7 has not begun.

## Verification and boundaries

Final portable gate: `npm run check` — **190 tests passed, 0 failed, 0 skipped**, including strict TypeScript checking. `git diff --check` passed. Actual Pi 1.0.1 SDK tests use a fake model turn with no provider credentials: exactly one proposal tool, no ambient extensions/context, and a closed capability after disposal. This is not a live provider completion test.

Domain and policy depend only inward; services depend on domain/ports/services. Pi delegates and renders without SQL. SQLite implements the teaching port. Content adapters cannot import repositories or mutation services. No package/dependency changes, DESIGN_SPEC changes, or M7 modules.

Teaching context selects a bounded verbatim title-relevant window from the same historical segment or stored research body, rather than assuming its first 1,800 characters are instructional content. It retains exact reference identity, original anchors/warnings and research URL; this is a transparent lexical heuristic, not semantic retrieval. Display snapshots retain trusted citation metadata.

Migration 7 adds teaching_sessions, teaching_moves, teaching_support and teaching_outcomes. Course/version/concept/task/attempt/evaluation/evidence ownership uses composite foreign keys. Unique indexes enforce one active session per course and one unresolved interactive move. Content-only moves cannot own tasks. Immutable content, identity, support receipts, outcomes and sealed summaries preserve audit history. Historical migration 1–6 checksums exactly match approved M5; fresh and M5-upgrade regression tests pass. Prior populated data is exercised by isolated M5 acceptance copies.

## Exact instructional policy

`bounded-instruction-v1` pins the curriculum. Compatible completed M5 frontier recommendations seed targets; explicit concept selection overrides them; a grounded prerequisite root is the fallback. M5 provisional findings never become knowledge state. An active session resumes with compatible options despite newer activation; a subsequent session may use the new version.

Default budget 24, range 1–80. Every content/task/hint move counts. The initial interactive activation is independent. Correct independent activation gives a focused explanation followed by practice. Incorrect/uncertain performance first receives level-one support. Levels are independent (0), minimal cue (1), targeted hint (2), partial structure (3), worked solution (4); mapping is none/minimal/guided/guided/worked_solution. Explicit AI performance remains ai_performed. Highest support cannot reset on the same task. Model input contains at most six earlier prompts and 4,000 characters of relevant actual response; only intentional level four receives a scoring key.

After two difficulties, one direct prerequisite may be selected by stable order. The persisted return stack is bounded at four frames and preserves the original episode and its support. After the prerequisite episode the original target receives its selected scaffold before practice. There is no graph-ancestor evidence merely from navigation. Both chain and diamond tests verify return paths; a diamond diagnostic yields multiple teaching targets.

Correct practice leads to teach-back. Teach-back is an actual M4 self_explanation task with an explicit rubric, immutable rich learner response and **unscored** deterministic evaluation. It does not verify semantic correctness. A fresh independent changed-context check follows. Assisted success and a displayed worked solution cannot finish an episode without that check. Two failed transfer checks end the episode as needs_more_instruction. Outcomes completed_independently/completed_with_support/needs_more_instruction/deferred describe instruction in this session only. The session ends when selected episodes end or a budget/grounding/learner stop occurs; its stop reason is a workflow result, not a knowledge claim.

Active decisions read current terminal M4 evaluation heads; failed or conflicting heads block progression. A generation result is rejected if those heads or the workflow revision changed while awaiting the model. Final episode outcomes are reconciled against current independent-check heads. Final summaries freeze the IDs as of completion; audit retains later correction lineage.

Generation/validation failure creates no move/task and requires explicit retry. Task/move creation is atomic through M4's existing link callback. Committed attempts and evaluation/evidence writes survive failed teaching links and recover via persistent operation IDs without duplicate performance. Failed evaluation preserves an answered unresolved move; retry follows M4 supersession. Replayed next returns an existing pending task. Concurrent generation commits at most one move.

## Required demonstrations

| Behavior | Evidence |
| --- | --- |
| Diagnostic handoff / explicit start / fallback | Compatible M5 integration, curriculum-switch regression and private acceptance |
| Curriculum snapshot / restart / one active session | File-backed reopen with retained hint, v1 under v2 activation, new v2 session |
| Question first / explanation / learner M4 performance | Real SQLite pipeline tests and Logic/Python episodes |
| Evidence-driven adaptation / minimal cue / escalation | Incorrect checks, actual support receipts and four bounded levels |
| Assistance / AI distinction / worked solution / later independence | Hint-cap test, explicit AI submission and Logic profile D |
| Backtrack / return / multiple frontiers / diamond | Actual graph integration and Logic profile C |
| Representation change | Same concept uses text then mixed; separate M4 task metadata, no inferred cross-format evidence |
| Teach-back | Rich own-words capture with unscored rubric; never keyword-graded |
| Unresolved move / generation and evaluator recovery | Replay, concurrent generation, injected failures and M4 lineage tests |
| Atomic linking / completion / abandon / frozen summary | Transaction rollback, link recovery and correction-aware audit tests |
| Injection boundaries / Pi command | Hostile sources and responses remain data; control fields rejected; multiline JSON preserved |
| No durable learner state | Schema inspection and AST boundary tests: no mastery/gap/review tables or services |

Explanations and hints create no attempts/evaluations/evidence. M4 remains the sole performance ledger. The model cannot control graph navigation, write evidence, activate curriculum or mark mastery. Source and learner text are untrusted data. No gap escrow, scheduling, forgetting, web UI or OpenClaw enters M6.

## Private meaningful-content acceptance

ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.

The reproducible adapter script takes a separate ignored reviewed lesson catalog: `node scripts/validate-teaching.ts <private-catalog.json>`. It snapshots an existing populated M5 database per profile, upgrades each copy, resolves actual M3/M2 provenance, runs the real M4 pipeline and writes its complete private audit under _learning/m6-acceptance/. Original database hashes remain unchanged. No web research occurs. Reviewed local lessons supply meaningful course checks, not orchestration tokens; a successful live model generation is not claimed.

Final Logic run: `_learning/m6-acceptance/run-IfMXFt/report.json`. Curriculum v2; compatible completed diagnostic handoff is demonstrated separately, then each profile starts explicitly. The report preserves actual target/course/diagnostic IDs, grounded excerpts and physical page anchors, all synthetic responses, task/attempt/evaluation/evidence IDs, moves, scaffolds, outcomes and stop reasons.

| Profile | Target / route | Moves | Scaffolds | Outcome / stop |
| --- | --- | ---: | --- | --- |
| A | Atomic statements | 5 | 0 throughout | completed_independently / instructional_goal_reached |
| B | Logical connectives; initial failure, cue, supported success | 5 | 0 → 1 → fresh 0 | completed_with_support / instructional_goal_reached |
| C | Logical connectives; repeated difficulty → atomic prerequisite → original target | 12 | 0 → 1 → prerequisite 0 → original 2 → fresh 0 | prerequisite completed_independently; target completed_with_support / instructional_goal_reached |
| D | Truth values; worked support → fresh independent changed application | 8 | 0 → 1 → 2 → 3 → 4 → fresh 0 | completed_with_support / instructional_goal_reached |

Reviewed grounding uses Topic 0 physical pages 4, 5, 6 and 27 (physical page 27 has a different printed slide number). Explanations retain course distinctions and notation; checks include generated assertions, connective translations and changed signal/status contexts. Worked examples are distinct from independent checks. Private generated explanations/catalogs remain excluded from review artifacts.

Final Python run: `_learning/m6-acceptance/run-fw5wKB/report.json`. Existing generated curriculum v2, Values and expressions, five moves: activation → explanation → independent practice → unscored teach-back → changed application. It uses the already retrieved Python tutorial introduction reference, exercises arithmetic/grouping in a new application, and finishes completed_independently. Research origin stays distinct from learner sources. No new retrieval.

## Limits

Structural validation proves shape, bounds and supplied provenance identities, not semantic factuality. Provider-generated questions may still be weak, leak answers semantically, or provide an isomorphic problem despite requested near-transfer. The reviewed private acceptance checks meaningful changed applications, but does not prove every future generated proposal. Mixed representation is a requested task format, not an inferred learner capability. Open explanation/proof/code semantics are unscored; no live semantic evaluator was added. Starting preferences/deadlines, richer pedagogical policies and durable learner-state interpretation remain outside M6.

## Complete review inventory

`m6-review.diff` represents all 26 implementation/test/docs files below relative to the exact approved M5 baseline. No staging or committing occurs. All untracked M6 files are included. Package files are unchanged. Private PDFs, responses, extracted text, generated explanations, transcripts, catalogs, _learning/, acceptance reports/databases, node_modules, caches and temporary artifacts are excluded.

```text
.pi/extensions/index.ts
README.md
docs/APPROVED_DECISIONS.md
docs/M6_VALIDATION.md
scripts/validate-teaching.ts
src/domain/teaching-policy.ts
src/domain/teaching.ts
src/persistence/database.ts
src/persistence/migration-7.ts
src/persistence/migrations.ts
src/persistence/teaching-repository.ts
src/ports/teaching-generator.ts
src/ports/teaching-repository.ts
src/runtime/pi/register-teaching.ts
src/runtime/pi/teaching-generator.ts
src/services/teaching-content.ts
src/services/teaching-context.ts
src/services/teaching-service.ts
tests/assessment-pipeline.test.ts
tests/boundaries.test.ts
tests/diagnostic-integration.test.ts
tests/helpers/teaching-fixtures.ts
tests/pi-integration.test.ts
tests/teaching-generator.test.ts
tests/teaching-integration.test.ts
tests/teaching-pi.test.ts
```
