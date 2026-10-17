# Personal learning engine — M9 integration and hardening

This repository provides durable courses, versioned sources, curriculum graphs, assessment/evidence history, bounded diagnosis/teaching, learner-state projections and a review queue through Pi. Models propose content; application services own durable writes. M4 owns performance, M7 interprets learner state, and M8 schedules future observations.

The authoritative product specification is [docs/DESIGN_SPEC.md](docs/DESIGN_SPEC.md). Approved refinements and engineering choices are in [docs/APPROVED_DECISIONS.md](docs/APPROVED_DECISIONS.md).

## A normal learning session

After installation, run `npm run dev` and enter `/learning-help`. Workflows are explicit commands; ordinary clarification questions remain ordinary Pi chat.

1. Create a source course with `/course new source_grounded "My course" "My objective"`, then `/course use course-<UUID>`.
2. Put your material under `sources/inbox/`; run `/source add "sources/inbox/lecture notes.pdf"`. Inspect extraction warnings with `/source status source-<UUID>`.
3. With a configured Pi model, run `/curriculum build`. Inspect `/curriculum show`, validate with `/curriculum validate`, and explicitly activate the reviewed version with `/curriculum activate 1`.
4. If useful, run `/diagnostic start`, then `/diagnostic next`. Submit each actual answer using the JSON syntax below. Continue `next` until the diagnostic completes; its frontier recommends instruction, not mastery.
5. Run `/teach start` and `/teach next`. Answer the displayed move using `/teach answer move-<UUID> {"response":"your answer"}`; request `/teach hint` when needed. Continue `next`.
6. Inspect `/state`, `/readiness` and `/gaps`. Teaching completion alone is insufficient for competence. Rich teach-back is captured unscored; missing independently scored dimensions remain missing.
7. Inspect `/review`; use `/review next` when due, then `/review answer review-<UUID> {"response":"your answer"}`. Due time requests a new observation; it never establishes mastery itself.
8. Use `/learning-doctor` for installation/database health. After restarting Pi, reselect your course; durable sessions, responses and reviews survive.

For a generated course, create `/course new generated_curriculum "Python" "Learn Python basics"` and select it. Skip source ingestion, build and inspect the curriculum, then activate and follow the same flow. Current generated research is a narrowly bounded Python official-documentation proof using approved seeds; this is not an arbitrary-topic web researcher. Stored research provenance remains distinct from learner sources. Hybrid mode uses source-first grounding where usable source references exist.

Generation needs a configured Pi model. Course/source/curriculum inspection, evidence audits, deterministic grading, learner-state calculation and review queues work without provider credentials. Transient generation failures can be retried with `next`. A retained answer whose evaluator failed uses the relevant `retry` command; do not resubmit a different answer as a retry. The detailed command sections below describe recovery and audit syntax.

## Install and validate

Use Node **24.19.0 or a later Node 24 patch** and npm. From this directory:

```powershell
npm ci --ignore-scripts
npm run check
```

Dependencies are pinned in `package.json`; `package-lock.json` locks their transitive dependencies. Install scripts are unnecessary for this configuration.

- `npm run typecheck` checks project TypeScript against the installed Pi declarations.
- `npm test` runs Node's built-in test runner, including a real Pi SDK extension-loading test. Tests use isolated temporary directories and do not require credentials or model calls.
- `npm run check` runs both.

Lint/format dependencies are deferred. TypeScript uses strict checks; `skipLibCheck` skips checking third-party declarations while still checking our use of their APIs.

## Launch

```powershell
npm run dev
```

This uses the pinned local Pi executable and `.pi/extensions/index.ts`. Accept Pi's project-trust prompt if shown. Enter:

```text
/learning-status
```

The command displays the schema version, SQLite version, and FTS5 availability. It does not need a model call. Normal AI conversation requires separately configured Pi provider credentials; never put credentials in this repository.

Database initialization occurs on `session_start`, creating `_learning/learning.db`. `_learning/` is ignored by Git. Migrations 1–9 preserve course/source/curriculum and M4 performance history, M5/M6 workflows, M7 learner-state/gaps and M8 review schedules. Extensions run with the current user's permissions; the path checks are not an operating-system sandbox.

## Courses

Create a course with its mode, title, and objective:

```text
/course new source_grounded "Propositional Logic" "Understand the module"
/course list
/course use course-<UUID shown by new or list>
/course current
```

Modes are `source_grounded` (supplied course material), `generated_curriculum` (a goal with externally researched material), and `hybrid` (both). The mode does not change during ingestion. See the curriculum commands below for the bounded M3 generation flow.

Double-quote arguments containing spaces. Quoted strings accept JSON escapes such as `\"` and `\\`. `/course new` without arguments shows usage. Empty titles/objectives, invalid modes, malformed IDs, and missing courses produce errors.

IDs are `course-` followed by a lowercase UUID v4. They are independent of titles; duplicate titles are allowed. Copy the complete ID printed by creation or listing. Creating a course does not automatically select it.

**Selection is session-scoped:** each live Pi session keeps its own active course ID in memory. Session shutdown, replacement, reload, or application restart clears the selection. Course records persist in SQLite across restart. Select a course again with `/course use`. No global current-course preference is stored.

Native Windows can use Pi's optional PowerShell tool; Pi's `!` shell commands require Bash. M0 diagnostics need neither shell tool. See the [Pi Windows guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/windows.md).

## Sources

Place private material under `sources/inbox/` or `sources/courses/`, select a course, and explicitly name each input:

```text
/source add sources/inbox/topic0.pdf
/source add "sources/inbox/lecture notes.md"
/source add https://example.com/module-page
/source list
/source status source-<UUID shown by add or list>
/source status source-<UUID> 1
/source search "implication"
/source search "truth table" source-<UUID>
/source add https://www.youtube.com/watch?v=abcdefghijk --captions sources/inbox/captions.vtt
```

All source commands require the live session's active course. The adapter delegates to `SourceService`; it neither parses nor writes SQL. Source commands require no model credentials. Source text is untrusted data, displayed with that label, and is never executed or sent as runtime instructions.

Local input must be a regular file beneath this project's `sources/`. Traversal, symlinks/junctions, and files larger than 32 MiB are rejected. Files are opened read-only; originals are not rewritten. Path checks defend ordinary ingestion boundaries, not against a hostile local process concurrently replacing filesystem entries.

Supported extraction:

| Format | Segments and anchors | Limitations |
| --- | --- | --- |
| PDF | One segment per physical PDF page, including empty pages | Native text only; no OCR, vision, or inferred image text. Pages below 40 extracted characters receive sparse/empty warnings. All PDFs retain a visual-fidelity warning. |
| PPTX | Presentation slide order, slide text and labeled speaker notes | XML shape order; no visual layout/diagram interpretation. Bounded ZIP expansion and only relevant XML parts are read. |
| Markdown | ATX/setext heading sections, heading hierarchy, bounded chunks | Deterministic section parsing, not a full Markdown renderer. Fenced-code headings stay text. |
| TXT | Chunks of at most 4,000 UTF-16 code units | UTF-8 input; exact start/end-exclusive text offsets. |
| HTML / URL | Static readable sections, heading paths, raw HTML offsets | UTF-8 HTML; heuristic main/article/body selection removes obvious chrome. No JavaScript rendering. Only the supplied URL and up to five HTTP redirects are fetched, without cookies or authorization. Downloads are bounded and timed out. |
| YouTube | Explicitly supplied WebVTT cues with time ranges | No scraping or audio transcription. Without captions, a version records `transcript_unavailable`. Caption language/channel/title are not guessed. |

PDF `page 41` means the 41st physical page in the file, not a printed slide number. Academic slides may include builds with repeated printed numbering. Native text can flatten formulas, proof rules, and truth tables; `ready_with_warnings` means text is available, not that the whole page was understood. Visual references are placeholders for later rendered-page extraction.

Extraction status is persisted per version: `ready`, `ready_with_warnings`, `extraction_incomplete`, `failed`, or `transcript_unavailable`. Unsupported input is rejected clearly before persistence. Parser failures record a failed version with no searchable text. `/source status` exposes stored warnings, hash, parser, origin location, ingestion time, and segment count.

## Identity, history and retrieval

Each source belongs to exactly one course. Logical identity is `(course ID, normalized project-relative path)` or `(course ID, final URL)`. Local identity and provenance use `/` separators, such as `sources/inbox/topic0.pdf`; Windows identity is case-insensitive. Absolute paths are transient filesystem-safety details. Relative and absolute references resolve to the same identity, and moving the whole project preserves it. Renaming/moving a source within the project or changing a redirect's final URL creates a different logical source. YouTube identity uses its canonical video URL. File origin is `learner_file`; explicitly supplied URL origin is `learner_url`. Future researcher material must use separate provenance, not these labels.

SHA-256 hashes the original input bytes (HTML response bytes or supplied caption bytes). Missing captions use a deterministic unavailable marker. Same identity/hash reuses the existing immutable version; changed bytes add an increasing version number. Reverting to older bytes selects that retained version without duplicating it. Timestamps and extraction details on historical versions remain unchanged. Versions retain extracted text and anchors, not a snapshot of the original binary or HTML; future visual reinspection requires matching original bytes. Parser-upgrade/reprocessing policy is deferred; re-ingesting identical bytes does not replace an earlier extraction, including a failed extraction.

One transaction writes the version, segments, FTS index, and current-version pointer. Migrations 1 and 2 remain unchanged. Migration 3 also enforces lowercase UUID-v4 source IDs and non-empty identities in SQLite, independently of service validation.

FTS5 uses SQLite `unicode61` tokenization and BM25 ranking; literal query words are combined with AND. Unicode Symbol-category characters (including logical/mathematical operators, currency symbols and emoji) add parameterized, case-sensitive literal-presence constraints. For example, `P → Q` requires words P and Q plus the actual → symbol in the same segment; an operator is never discarded. Symbol-only `¬`, `→`, `⊨` and `⊢` queries use a literal fallback with rank 0 and stable source-ID/segment-order sorting. Distinct symbols are combined with AND. This matches component presence, not formula order or mathematical equivalence. Queries allow 1–32 total word/symbol components; punctuation outside the Unicode Symbol category is a separator. Input cannot inject SQL or FTS operators.

Search is always course-scoped, optionally source-scoped, and searches current versions only. It returns segment text, kind/title/origin, source and version IDs, rank, location, hash, and typed anchors. Historical versions remain accessible through the service/repository and `/source status <id> <version>`.

Before future visual/hybrid reprocessing augments extraction, introduce explicit extraction revisions rather than mutating historical segments. Before URL ingestion becomes autonomously callable by a model/agent, review and implement private-network/loopback/link-local SSRF protection. M2 URL ingestion is explicitly user-directed; these systems remain deferred.

`sources/inbox/*` and `sources/courses/` are ignored by Git; only the inbox keep file is retained. Extraction databases, acceptance reports, and rendering artifacts stay under ignored `_learning/`. Neither private originals nor derived private text should be staged.

## Local real-material acceptance

Portable automated tests use synthetic fixtures and a controlled local HTTP server; they do not depend on public websites or private course files. For the supplied `topic0.pdf`, `topic1.pdf`, and `topic2.pdf`:

```powershell
node scripts/validate-logic.ts
```

This creates an isolated workspace beneath `_learning/m2-acceptance/`, copies the three files without changing originals, and exercises the real pinned Pi SDK without model calls. It validates page extraction/search, session restart, unchanged re-ingestion, and two versions of a controlled text fixture. Original hashes are checked. The private report, including command outputs, is `_learning/m2-acceptance/report.json`. The reviewable summary is [docs/M2_VALIDATION.md](docs/M2_VALIDATION.md).

## Boundaries

```text
.pi/extensions/index.ts       composition and session lifecycle
src/runtime/pi/               Pi command registration and presentation
src/services/                 application operations
src/ports/                    infrastructure contracts
src/domain/                   runtime-independent types
src/persistence/              SQLite and migrations
src/ingestion/                safe input reading and independent format parsers
scripts/validate-logic.ts     local real-material acceptance, outside portable CI
```

The service accepts a store interface. Domain, ports, and services cannot import Pi or persistence; an AST-based test enforces the inward dependency direction.

## Migrations

Add an ordered, consecutive migration in `src/persistence/migrations.ts` when a milestone requires schema changes. Never edit an already applied migration. Initialization validates recorded checksums and rejects unknown history; pending migrations run in one transaction. A failed migration rolls back its changes and ledger writes. Future destructive migrations require backups and prior-version fixtures as specified in the design.

## Scope and tradeoffs

Built-in SQLite avoids another database package and native Windows addon installation. Its APIs are synchronous; foundation queries are short. Only the APIs verified on the supported Node runtime are used. Node's SQLite stability designation can vary by Node patch; do not assume compatibility outside the declared Node 24 range.

Parser dependencies are pinned: `pdfjs-dist` 6.4.299 (Apache-2.0), `fflate` 0.8.3 and `htmlparser2` 12.0.0 (MIT). PDF.js's optional `@napi-rs/canvas` 1.0.10 includes a platform-specific native binary (Windows x64 MSVC 1.0.10 on the validated machine). Installation uses `--ignore-scripts`; no install scripts or local compiler are required. ZIP and HTML/XML parsing use portable JavaScript. Built-in Node APIs cover HTTP, files, hashing, SQLite and testing.

The Pi SDK integration tests verify extension loading, course/source/curriculum commands, and restricted builder tools without live model calls. Terminal appearance and provider authentication are not exercised. Synchronous SQLite writes remain short application transactions; extraction/fetching is async outside them, though native PDF/PPTX parsing can occupy the local runtime. M2 is approved; M3 awaits external review.

## Curriculum workflow

Select a course, then use:

```text
/curriculum build
/curriculum list
/curriculum show <version>
/curriculum validate <version>
/curriculum concept <concept-id> [version]
/curriculum prerequisites <concept-id> [version]
/curriculum research [brief-id]
/curriculum activate <version>
```

`build` requires a configured Pi model. It starts a separate in-memory SDK session with only evidence-reading and proposal-submission tools. No ambient extensions, MCP tools, context files, skills, shell or filesystem tools are loaded. Sources and previous curriculum text remain untrusted evidence. A validated proposal creates a draft; activation requires the explicit command. Tool calls are bounded to 60 per build and the model phase has a three-minute deadline. There is no live model/network dependency in portable tests.

Concept IDs are stable course-owned identities, separate from version-specific titles and summaries. Rebuild proposals explicitly reuse IDs; no title matching or automatic merging occurs. Immutable graph content and provenance survive newer versions. Activation atomically updates the course's current pointer and records first activation time, preserving history. Source changes never regenerate or rewrite curricula automatically.

Only `prerequisite_of` edges form a DAG. Other directed relationships may cycle. Node types describe concepts, definitions, procedures, representations, misconceptions, boundary cases and assessment objectives. An assessment objective is curriculum content, not a learner assessment result. Graph inspection includes incoming/outgoing relationships, direct prerequisites/dependents and deterministic prerequisite ordering. Compact display bounds its concept and relationship previews.

Source-grounded builds use frozen M2 source versions and exact segment references. Concept inspection resolves their original typed anchors. Generated Python builds first retrieve and persist official research, then expose that evidence to the model. Failed references remain inspectable and cannot support nodes. Hybrid builds currently use ingested sources; the service/proposal contract also supports explicit mixed provenance.

## Bounded M3 Python research

Research is deliberately restricted to six fixed HTTPS URLs beneath `https://docs.python.org/3/tutorial/`: `introduction.html`, `controlflow.html`, `datastructures.html`, `modules.html`, `inputoutput.html` and `errors.html`. There is no crawl, browser, general web search or arbitrary-URL model tool. A generated course must identify Python in its title or objective for the Pi build path.

Each document permits at most two redirects, all to another approved seed URL. Redirect loops and duplicate seed/final retrievals are rejected. The upper request budget is 18 connection attempts across six seeds. Every connection resolves and validates IPv4 addresses, rejects non-public ranges, pins the selected address through Node HTTPS's lookup callback, retains TLS verification and SNI for `docs.python.org`, and verifies the connected peer. IPv6 is intentionally unsupported in this small adapter. Credentials, other schemes/origins/ports/paths and query strings are rejected.

Requests use GET with a fixed user agent and no cookies/authentication. Each document has a 15-second deadline spanning DNS, redirects and body consumption, a 2 MiB HTML response limit, a 16 KiB header limit, and identity encoding only. Scripts never execute. Retrieved titles, final URLs, timestamps, raw HTML hashes, normalized evidence text, authority role, status and notes are persisted separately from learner sources. Seed topic tags are retrieval hints; curriculum nodes contain the reviewed synthesized claims and reference associations. Successful retrieval establishes provenance, not the correctness of every model interpretation.

Migration 4 adds relational curriculum and research tables. Migrations 1–3 and package dependencies remain unchanged. Application/domain logic is independent of Pi; only runtime adapters orchestrate SDK sessions, and SQLite adapters own SQL.

Local acceptance is documented in [docs/M3_VALIDATION.md](docs/M3_VALIDATION.md). `node scripts/validate-curriculum.ts prepare` copies private Topic 0–2 PDFs into an ignored isolated workspace and performs live bounded Python retrieval. After inspecting evidence, put reviewed `logic-proposal.json` and `python-proposal.json` files in that workspace, then run `node scripts/validate-curriculum.ts complete <workspace>`. This acceptance harness submits proposals through the model-facing tool and verifies activation, rebuild identity, history and restart; it does not simulate a successful live Pi provider call.

## Assessment and evidence (M4)

The durable pipeline is **task snapshot → actual submitted response → validated evaluation → evidence event**. `AssessmentService.createTask` resolves an explicit curriculum version or snapshots the active version once, validates stable concept membership and optional exact source/research provenance, and saves an immutable task. `submit` records a supplied response and assistance metadata; it never generates learner answers. Tasks are snapshots, not a question bank.

`EvaluationService.evaluate` accepts a provider-independent evaluator port returning a proposal. `record` accepts a trusted application/manual evaluation. Both validate outcomes before writing. The evaluator cannot retarget the course, concepts, curriculum, representation, novelty or assistance. A scored outcome has correctness in 0–1; partial correctness requires a task-specific rubric and complete criterion scores. Unscored outcomes have null correctness and no rubric scores. Failed invocations retain a failed evaluation and the original attempt, but create no evidence event. Retry with a new operation ID; retrying the original ID returns its original failure.

The deterministic adapter supports explicit exact/trim/trim-and-lowercase text comparison, known option identifiers, one finite decimal number with explicit nonnegative tolerance, and bounded JSON string-array set equality with explicit normalization/duplicate handling. No semantic explanation grader, expression parser, proof checker or code execution exists. Malformed numeric/choice/set answers are explicitly unscored. Numeric comparison uses ordinary JavaScript floating-point arithmetic without hidden tolerance. Open explanations require human interpretation or a future live open-response adapter; no live LLM evaluation is implemented.

Assistance preserves `none`, `minimal`, `guided`, `worked_solution` and `ai_performed`. Novelty preserves `repeated`, `isomorphic`, `near_transfer`, `far_transfer` and `authentic`. The nine intended dimensions are metadata, not scores. Optional confidence is 0–1 and latency is 0–86,400,000 milliseconds; neither establishes competence. Hint count is 0–100, with explicit highest assistance level and bounded notes. AI-performed output remains distinguishable from independent learner work. A self-report or confidence value alone cannot create evidence.

Task/attempt/evaluation/evidence IDs use lowercase UUID v4 with separate prefixes. Attempts and evaluations require course-scoped operation IDs: the same normalized request returns the original record, while a changed request conflicts. SHA-256 fingerprints include submitted response/metadata (or evaluator identity/policy and evaluation mode). Deterministic retries and manual recording survive restart. Task creation is a separate immutable snapshot operation, without a reusable question-bank interface.

Corrections append a same-attempt `supersedes` link and a new evidence event. Prior outcomes remain auditable. Terminal lineage heads may include separate evaluations or branches; M4 makes no authority/reconciliation decision. SQLite transactions protect snapshot mappings and evaluation/evidence writes; update/delete and late child-metadata insertion are blocked. Attempts commit before invoking evaluators. Task references supply historical concept/version/novelty/representation and provenance without duplicating source bodies.

Read-only Pi commands require the session's active course:

```text
/attempt show attempt-<UUID>
/attempt evaluations attempt-<UUID>
/evidence recent
/evidence show evidence-<UUID>
/evidence concept concept-<UUID>
```

These commands require no model credentials and expose no mutation tool. Submission/evaluation is currently an application API exercised by tests and explicit acceptance scripts; there is no teaching or assessment UI yet. Audit output identifies stored text as untrusted data and reconstructs task, response, assistance, evaluation policy/rationale, lineage and provenance links.

[docs/M4_VALIDATION.md](docs/M4_VALIDATION.md) describes portable checks and isolated structural acceptance against the approved Logic graph. All acceptance performance data is synthetic. At the M4 checkpoint there was no diagnostic process. Migration 5 is additive.

## Diagnostic probing (M5)

Diagnostics are durable, course-scoped sessions pinned to an immutable curriculum version. A deterministic policy selects a concept, a bounded proposal-only generator supplies a grounded task, and the actual submitted answer goes through M4's task/attempt/evaluation/evidence pipeline. Independent correctness provides provisional support or difficulty; assistance, AI-performed work, partial/unscored results and evaluation conflicts remain uncertain. Confidence never establishes competence. Representation, task type, novelty and assistance remain visible in the evidence audit.

The selector follows prerequisites and dependents, accounts for branches and disconnected regions, and stops at a budget, sufficient direct coverage, a structurally bounded frontier, or no eligible candidates. A frontier is a set of recommended starting concepts, not inferred knowledge. Unprobed ancestors and descendants receive no fabricated evidence. Prior same-version attempts affect priority only; they cannot satisfy current-session coverage.

Eligibility includes a deterministic check for usable context from the pinned curriculum's provenance. Concepts without usable evidence are excluded from candidate ranking for that step, without consuming a probe or creating performance records; they remain `not_probed`. If no probeable candidates remain, the session ends with `no_eligible_probe`. This says nothing about whether the learner knows those concepts. Context limits count up to six usable source references or four usable research references, so unusable early references do not hide valid later ones. Source context still takes priority in hybrid concepts. Provider/model errors remain transient: the session stays resumable and retry may select the same target. No persistent blacklist or automatic model retry loop is added.

```text
/diagnostic start [budget]
/diagnostic status
/diagnostic next
/diagnostic submit probe-<UUID> {"response":"your answer","assistance":"none","hints":{"count":0,"highestLevel":"none","notes":null}}
/diagnostic retry probe-<UUID>
/diagnostic skip probe-<UUID>
/diagnostic summary diagnostic-<UUID>
/diagnostic audit diagnostic-<UUID>
/diagnostic history
/diagnostic abandon
```

Select an active course with an activated curriculum first. The default budget is 6, with an explicit range of 1–20. Starting again with the same budget resumes the existing session; a different budget conflicts. `next` returns an existing pending probe without generating another. Call `next` after each resolved or skipped probe to select again or finalize the session. Submitted JSON preserves spaces and symbols; use `\n` inside response strings for multiple lines. Assistance and hints describe what actually occurred; they are never inferred from confidence. Answers cannot be edited through replay: a changed submission conflicts with its original operation.

`next` needs a configured Pi model only when generating a new task. Its separate in-memory session has exactly one proposal tool and no ambient extensions, skills, context files, shell, filesystem or evidence-writing tools. Context contains bounded excerpts for the selected node with exact source/research references. Sources take priority in hybrid graphs; generated courses use existing M3 research without new retrieval. The generator cannot select concepts or stop sessions. Proposals cannot alter identity, assistance, evidence or learner state. Expected answers remain in evaluator-only scoring fields; structural checks reject obvious answer-key markers, but semantic answer leakage and question quality still require scrutiny.

M5 uses M4's deterministic text/choice/numeric/set graders. It does not grade open explanations. Submission feedback is neutral, without correctness, answers or teaching interventions. Final summaries are available after completion or abandonment. An abandoned session preserves history and produces no frontier recommendation. Completed summaries are immutable as-of snapshots; later M4 corrections remain visible through audit without rewriting that snapshot. M4 audit commands can still expose full assessment records when explicitly requested.

Migration 6 adds diagnostic state and links; migrations 1–5 and package dependencies are unchanged. SQLite remains canonical. M5 itself introduces no durable mastery/readiness, gaps or review scheduling; those belong to later sections. There is no web UI or OpenClaw. See [docs/M5_VALIDATION.md](docs/M5_VALIDATION.md) for checks, limitations and isolated synthetic acceptance.

## M6 teaching

Teaching is session-local instruction, not durable mastery. `/teach start` prefers a completed diagnostic from the same course/current curriculum; an explicit target bypasses that recommendation. Otherwise it selects a grounded prerequisite root. Sessions pin their curriculum and survive restart.

```text
/teach start
/teach start {"conceptId":"concept-<UUID>","budget":24}
/teach next
/teach answer move-<UUID> {"response":"paragraph one\nparagraph two"}
/teach hint
/teach retry move-<UUID>
/teach status
/teach summary teaching-<UUID>
/teach audit teaching-<UUID>
/teach history
/teach abandon
```

Activation comes first. Independent activation success receives a focused grounded explanation and practice; difficulty starts with a minimal cue. Support escalates from cue to targeted hint, partial structure and worked solution. Repeated difficulty may detour to a direct prerequisite and then return. Assisted success requires a fresh independent changed-context check. Teach-back captures your own explanation through M4 with an explicitly **unscored** open rubric; automated semantic grading is deferred.

Hint receipts persist and cannot erase assistance from the outstanding task. All interactive performance uses the existing M4 task/attempt/evaluation/evidence ledger. Explanations and requested hints alone create no performance evidence. The content model proposes bounded content in an isolated Pi session; deterministic policy controls navigation and SQLite writes.

Default budget is 24 moves (1–80 configurable), including hints and explanations. Only one interactive move remains unresolved. Generation failures create no move; failed evaluation retains the answer and requires explicit retry. A completed summary freezes the M4 heads and evidence IDs used at completion, while audit retains later corrections.

Source-grounded content resolves historical course segments and anchors; generated content uses existing research provenance. Hybrid contexts prioritize learner sources. No new research, dependency, mastery/gap state or review scheduler is introduced. Generated content still requires semantic review: structural validation cannot prove factual correctness, detect every answer leak, or guarantee that a purported transfer problem is genuinely different. Actual provider completion is not covered by credential-free SDK tests.

See [M6 validation](docs/M6_VALIDATION.md) for evidence, private acceptance limitations and the complete review inventory.

## M7 learner state, readiness and gap escrow

M7 derives local learner-state revisions from canonical M4 performance. It uses nine dimensions and categorical bands, including the approved assisted_difficulty band. It stores evidence counts, actual assistance/representation/novelty metadata, uncertainty and M4 audit references. There is no overall mastery percentage and no model call.

```text
/state
/state concept concept-<UUID>
/state revision state-<UUID>
/state history
/state rebuild
/readiness
/readiness concept concept-<UUID>
/gaps
/gaps all
/gaps show gap-<UUID>
```

Select a course with an active curriculum first. Reports refresh idempotently: unchanged evidence, curriculum and policies reuse a revision. New evidence or corrected evaluation lineage creates a new immutable revision. Stable concept IDs can reuse evidence across curriculum versions; similar titles do not transfer evidence. Revision audit retains the original evidence versions and terminal evaluation IDs used.

Instructionally ready means prerequisites permit beginning instruction. Provisional competence requires the node-type profile's independent evidence and no blocking OPEN/REPAIR gap. Durable mastery additionally requires a genuinely later independent non-repeated check at least 24 hours later, no later qualifying independent failure, no unresolved applicable gap and no relevant evaluation ambiguity. One concept-level delayed check is sufficient; each dimension need not have a separate delayed test. These are transparent V1 estimates, not psychological certainty.

Gap escrow records meaningful single-concept scored failures, including failures despite assistance. Assisted or same-item success can start repair. Independent changed-case success moves into AWAITING_VERIFICATION; another independent changed check at least 24 hours later can close it. New failure resets an active gap; failure after verified closure creates a linked recurrence. Corrections can remove an obsolete gap from current state without deleting prior beliefs or M4 evidence.

M5 diagnostic labels and M6 teaching completion do not grant competence. Unscored teach-back cannot establish structural support, assisted performance is not independent, and AI-performed output cannot supply competence or close gaps. Exact reused tasks/prompts cannot verify delay or supply new positive transfer merely by retaining an old novelty label. M7 eligibility timestamps remain verification gates. M8 uses them to schedule future observations without changing M7 rules.

See [M7 validation](docs/M7_VALIDATION.md) for the exact policies, schema, demonstrations, limitations and complete review inventory.

## M8 review and spacing

Select an active course/curriculum, then use:

```text
/review
/review next
/review answer review-<UUID> {"response":"answer\ncode or symbols"}
/review retry review-<UUID>
/review status
/review history 10
/review show review-<UUID>
```

The queue shows eligible due/overdue items, upcoming dates and gaps needing repair. It displays at most 10 per group by default; history accepts 1–50. Review kinds are delayed verification, gap verification and maintenance. M7 provides delayed/gap eligibility timestamps; next cannot select them early. OPEN/REPAIR gaps go through teaching, not scheduled gap verification. Repeated next resumes one unresolved course review, even after restart. Re-select the course after restarting Pi.

Maintenance uses evidence-spacing-v1: **3 → 7 → 14 → 30 → 60 days**, continuing at 60 days. Only qualifying independent scored success advances one stage. Assisted, AI, partial, ambiguous or unscored work does not advance it; a still-relevant review requirement gets an independent opportunity after 24h, subject to M7's stricter gate. Failure is recorded in M4 and interpreted by M7. Regaining durability after difficulty starts maintenance at stage zero. Overdue means an observation is late, not that knowledge has decayed. Time and self-report never complete reviews or create evidence.

Queue priority is overdue gap, due gap, overdue delayed, due delayed, overdue maintenance, due maintenance. Greater lateness takes precedence within a class; equivalent candidates interleave concepts, dimensions, task types and representations with stable ties. Maintenance rotates among the actual profile's required dimensions, preferring the least recently independently demonstrated. The scheduler is deterministic; there is no forgetting probability, mastery score or claim of official FSRS.

A review generates one immutable M4 task only when selected. Content comes from stored exact M3 source/research provenance, with no new retrieval. Hidden scoring fields stay out of the review display. Use JSON responses to preserve spaces, symbols and multiline code. Optional assistance/hint metadata must describe actual help; review does not supply hints or worked solutions itself. Use /teach for repair.

The generator runs in a separate Pi session with only propose_review_task. It cannot choose concepts, due dates, dimensions, stages, assistance outcomes or learner state. Structural validation rejects unknown control fields, invented provenance and normalized prompt repeats; it cannot prove semantic novelty or factual quality. Closed M4 text/choice/numeric/set graders are used; open explanation grading is unavailable. Structural understanding requires structured scoring, never exact-text grading of an explanation. Missing usable grounding is audited as no_evaluable_review_task and does not block another due candidate; transient provider failure remains retryable.

M4 attempts/evaluations/evidence persist before M7 refresh and M8 reconciliation. A failed evaluator retains the same attempt for explicit retry. A later refresh repairs incomplete links; an M7 failure never advances a stale schedule. Completed items keep their original constraints, dates and performance links; corrections affect future reconciliation through current terminal heads. Old curriculum history remains intact, while new tasks use the active version. Only explicitly reused stable IDs carry compatible review history.

Migration 9 is additive. It adds review identity/progress/events/outcomes/reconciliation and an immutable review_generated task-origin extension; original source-derived/curriculum-generated origin metadata remains intact. Migrations 1–8 and package dependencies are unchanged. The M7 read-only competence timeline identifies the qualifying durability event using its existing policies, without publishing state or changing mastery semantics.

No background jobs, notifications, web UI, question bank, new research, dependency or M9 feature is included. See [M8 validation](docs/M8_VALIDATION.md) for test coverage, synthetic acceptance, recovery limits and the full review inventory.

## Health, privacy and local backup (M9)

`/learning-status` gives lightweight foundation status. `/learning-doctor` deliberately runs SQLite integrity and foreign-key checks plus migration-history validation, and shows resumable subsystem IDs/counts for the selected course. It does not print answers, scoring keys or source bodies, refresh learner state, create schedules, repair corruption or reset data. Startup checks foreign-key enforcement, historical migration checksums, schema compatibility, FTS5 and JSON support. A newer schema is refused rather than downgraded. Stop writers and preserve a copy if health fails.

Canonical state is local at `<project>/_learning/learning.db`. `_learning/` and private `sources/inbox/` contents are Git-ignored; keep private files there, not in public tests/docs. Each project has its own database and ephemeral active-course selection. Lists and command notifications are bounded; inspect specific IDs for detail. Full immutable records remain in SQLite.

**Cloud disclosure:** when a cloud model is configured, bounded source/research excerpts, course context and (for teaching feedback) bounded learner-response context supplied for generation may be sent to its provider. Source material does not necessarily remain on-device. The current evaluators are deterministic/local; there is no live semantic LLM grader. Learner-state/readiness/gap calculation and spacing are deterministic/local. The engine does not store provider credentials in `learning.db`; Pi owns provider authentication separately. Explicit audit commands can display sensitive stored responses and scoring fields to you, so treat terminal capture and exported audits as private.

For a manual local backup:

1. Exit Pi and stop all other database writers for this project.
2. Copy `_learning/learning.db` to a safe private location. If SQLite journal/WAL sidecars remain, retain the entire `_learning` directory together rather than copying a live/incomplete database.
3. Retain original source files separately where needed. Restore only with writers stopped, retain the original backup, and run `/learning-doctor` after opening the restored project.

There is no automatic corruption repair, cloud sync or global cross-project learner model. Current limitations also include no semantic open-response grading, unscored rich teach-back, no background notifications, no web UI, no OpenClaw and no question bank. Spacing is the approved deterministic ladder, not official FSRS. Semantic correctness, answer leakage and genuine novelty of live generated content still require human scrutiny.

[M9 validation](docs/M9_VALIDATION.md) records the portable gate, clean-copy installation, recovery matrix and isolated synthetic Logic/Python acceptance. All M9 acceptance performance is development data, never a claim about the real learner.
