# Approved architecture refinements

These user-approved decisions supplement `DESIGN_SPEC.md`, whose original contents are preserved.

## M3 implementation decisions

The user approved the pre-coding graph architecture and the bounded official-documentation adapter. The following details implement that scope:

- A stable course-owned `concept-<UUID v4>` is distinct from each curriculum version's node presentation. Proposal-local keys identify edge endpoints; explicit existing concept IDs request reuse. Titles never allocate or merge identities. Builder manifests include identities from historical versions, including concepts omitted from the latest version.
- Curriculum content is immutable after draft creation. First activation time is lifecycle metadata; the active state derives from one course/version pointer. Activation is an explicit application operation outside the model tool set. Rejected proposals and failed transactions preserve existing curricula.
- Only `prerequisite_of` is a dependency edge in M3, directed prerequisite to dependent. All other supported relations are directed without dependency semantics. Reciprocal non-prerequisite relationships are allowed; duplicate typed edges and all self-relations are rejected as unhelpful in this slice. Node/edge enums are centralized in the domain.
- Proposals reject unknown fields and enforce runtime bounds: 1–500 nodes, up to 2,000 edges, up to 20 source and 20 research references per node, and bounded text/uncertainty. No mastery, learner status, activation or course-mutation fields are accepted. Every node requires provenance; source-grounded nodes use learner evidence, generated nodes use retrieved research, and hybrid nodes can mix them.
- Source references retain course ownership, exact source version and exact segment identity. Anchors are resolved from M2. Relational foreign keys also enforce node/concept ownership and exact segment/source/version alignment. Source reads use a frozen historical build manifest rather than following updated pointers mid-build.
- Research is stored independently of M2 learner sources in briefs and immutable retrieved reference records. The fixed Python adapter supplies actual metadata and explicit failures. Seed topics guide retrieval; synthesized claims live in curriculum nodes with reference links and uncertainty. Hashes identify original HTML response bytes; stored normalized text is supplementary extraction of those bytes.
- Six fixed Python tutorial seed pages are approved. The model can inspect this persisted evidence and submit a proposal; it cannot supply network targets or edit the policy. Public IPv4-only DNS resolution, pinned lookup, peer verification and TLS hostname checks prevent autonomous retrieval from inheriting M2's deferred arbitrary-URL assumptions. Limits are six seeds, two redirects per document, 15 seconds per document, 2 MiB HTML and 16 KiB headers. No crawl, proxy configuration, cookies, authentication, browser or new dependency is introduced.
- Pi 1.0.1 uses `createAgentSession`, explicit tool allowlists, custom JSON-schema tool parameters and a clean resource loader. Its `tool_search` is tool discovery, not web search. The model builder's separate in-memory session exposes two tools only and does not load ambient extensions/MCP/context/skills. This restricts capabilities without claiming an operating-system sandbox. Application services remain independently testable with fake ports.
- Migration 4 is additive and separate from unchanged migrations 1–3. Graph creation and activation use explicit short SQLite transactions. No agent code writes SQL. Markdown reports and compact maps remain supplementary artifacts.
- M3 acceptance used genuinely extracted private Logic text and genuinely retrieved Python documentation. Reviewed proposals were submitted through the model-facing tool. Real Pi SDK command/tool integration was separately tested with a deterministic fake model turn; live Pi provider authentication/completion was not validated on this machine.
- No diagnostic, attempt/evaluation, mastery/readiness, gap, review scheduling, teaching, quiz, web UI, OpenClaw or later specialist-agent behavior enters M3.

- Pi adapters call application services; services depend on domain/policy/port interfaces. Concrete adapters implement ports. Domain modules do not depend on Pi, SQL drivers, providers, terminal UI, or OpenClaw.
- `_learning/learning.db` is canonical application state. Models propose results; validated application/domain operations control durable mutations.
- Active course selection is session-specific and references a persistent course ID. It is not global workspace state.
- Only prerequisite/dependency edges must be acyclic. Other knowledge relationships may form cycles.
- Progression readiness and durable mastery are distinct. Names and thresholds belong to the learner-model milestone.
- Committed learning evidence survives chat branching and navigation.
- Source and curriculum history is version-oriented. Historical evidence must resolve its original source version.
- M0/M1 source contracts stay minimal. Versions, segments, artifacts, anchors, rendering, and retrieval are designed in M2 against real fixtures.
- A minimal researcher execution interface may enter M3 when needed; the full specialist framework stays deferred.
- Basic attempt/evaluation/evidence contracts precede probing; full mastery/gap behavior stays deferred.
- Evidence must be auditable and evaluations correctable without deleting historical attempts.
- YouTube/transcript ingestion stays in V1. Retrieval limitations must be explicit.

## M0 engineering choices

- Pin `@earendil-works/pi-coding-agent` 1.0.1, verified against npm and installed declarations.
- Use Node 24's built-in `node:sqlite`, not an ORM or third-party native addon. The tested Node 24.19.0 runtime provides SQLite 3.53.3 and FTS5.
- Use synchronous SQLite for short foundation operations. Keep driver types in persistence; review long-running work when ingestion is implemented.
- Use `node:test`, native TypeScript stripping, TypeScript 6.0.3, and Node types 24.19.1. TypeScript 7.0.2 was inspected but lacks the stable compiler API used for AST-based boundary checks; 6.0.3 supplies it without an additional parser dependency. No build runner, lint framework, or formatting dependency is needed for M0.
- The migration ledger is the only M0 schema. Each migration is checksummed; unknown/modified history is rejected. Pending changes and ledger entries commit together.
- The composition root opens/closes the database with Pi session events. `/learning-status` only delegates and renders diagnostics.
- Pi is a private project's development host dependency, not an application-domain dependency. This is not yet a distributable Pi package.

## M1 engineering choices

- The minimal Course has ID, title, mode, objective, created timestamp, and updated timestamp. Creation sets both timestamps to the same UTC ISO value; no update/delete operations are introduced.
- IDs use `course-<lowercase UUID v4>`, generated by Node `randomUUID` in the composition root and injected into the service. IDs do not derive from titles. Duplicate titles are allowed; primary-key collisions retry up to three allocations without overwriting existing records.
- Migration 2 adds only `courses`. Migration 1's SQL, name, version, and checksum are unchanged. A fixed M0 ledger fixture verifies upgrade behavior.
- The existing database connection supplies a course repository; `CourseService` owns input validation and operations behind the repository port. One parameterized insert atomically creates each course; storage errors preserve their cause internally and expose a generic message.
- `/course new <mode> "title" "objective"` uses double-quoted JSON-style strings. Other operations are `/course list`, `/course use <id>`, and `/course current`. No model tools or interactive form framework are introduced.
- One `CourseSession` object belongs to each extension runtime's live session. It only references an ID, resolves through `CourseService`, and clears on shutdown/start (including reload or replacement). Creation does not select a course. Selection is not persisted in SQLite or Pi entries.
- No new dependencies, source/ingestion schema, or later-milestone features are added.

## M2 engineering choices

- Source objects belong to one course. `SourceService` coordinates ingestion and retrieval through input-reader, parser and repository ports; parsers return normalized documents without Pi or SQLite dependencies. The Pi adapter only delegates and renders untrusted data.
- IDs use injected `source-<UUID v4>`. Logical identity is course plus normalized project-relative source path (case-insensitive on Windows, `/` separators), final HTTP URL, or canonical YouTube video URL. Local provenance and caption locations are project-relative too; resolved absolute paths are transient safety details. Moving the entire project preserves local identity; moving a source within it/changing a final URL creates another logical source. SHA-256 of original input bytes identifies versions; unavailable captions use a deterministic marker.
- Versions are immutable and unique by source/hash. Changed bytes append; unchanged bytes reuse; reverting selects an existing historical version. Historical extracted text, title, warnings, parser, hash, location, timestamps and anchors are retained. Original binary/HTML snapshots and parser-upgrade/reprocessing policy remain deferred; identical bytes do not replace an existing failed extraction.
- Migration 3 adds sources, source versions, source segments, and FTS5. It enforces lowercase UUID-v4 source IDs (including exact separator positions) and non-empty identities defensively in SQLite. Existing course rows and migrations 1/2 are unchanged. Foreign keys and one transaction protect source/version/current-pointer/index consistency. FTS is a supplementary index of canonical SQLite segments.
- Anchors discriminate physical PDF pages, PPTX slides/notes, Markdown/HTML sections and offsets, text offsets, and caption time ranges. PDF pages are 1-based physical file pages, including slide builds; printed numbers can differ. Empty pages stay addressable. Visual references identify deferred extraction, not understood visuals.
- PDF uses native page text; every PDF carries the visual limitation, and pages below 40 extracted characters carry page-specific limitations. No OCR/vision pipeline is implemented. PPTX follows presentation relationships then XML shape order, with labeled notes. Markdown supports ATX/setext headings and fenced code; text is bounded at 4,000 UTF-16 units. HTML parsing uses static main/article/body heuristics without executing scripts.
- YouTube uses explicitly supplied project-local WebVTT captions; unavailable captions persist `transcript_unavailable`. No brittle scraping, browser, or audio transcription is introduced. Caption origin is recorded; unknown title/channel/language are not inferred.
- M2 provenance is `learner_file` or `learner_url`; future researched/generated sources require distinct origin contracts. Source data is never runtime instruction or learner evidence.
- Local reads are restricted to explicitly supplied regular files under `sources/`, rejecting traversal and symlinks/junctions, with a 32 MiB limit. HTTP accepts credential-free HTTP(S), bounded HTML responses and at most five redirects; no cookies/authentication/crawl. Relevant PPTX XML expansion is bounded. These checks do not create an OS sandbox against malicious concurrent local filesystem changes.
- Parser dependencies: PDF.js `pdfjs-dist` 6.4.299 (Apache-2.0), `fflate` 0.8.3 and `htmlparser2` 12.0.0 (MIT), installed without scripts. PDF.js's optional canvas 1.0.10 uses packaged native platform binaries, tested on Node 24.19.0/Windows x64. No ORM, browser, OCR, embedding or web framework is added.
- `/source add`, `list`, `status`, and `search` use the session's active course. Search combines safe literal-word AND via SQLite unicode61/BM25 with parameterized literal-presence constraints for distinct Unicode Symbol-category characters. Symbol-only queries use a stable literal fallback with rank 0. Mixed queries retain their operators; matching tests component presence within a segment, not formula structure or equivalence. Search allows 1–32 word/symbol components, and current versions and course/optional source filters apply on both paths. Historical versions remain inspectable.
- Portable tests use synthetic material; real Logic acceptance runs in an ignored isolated workspace through the pinned Pi SDK and checks original hashes. Private source files and all derived private artifacts stay ignored. No M3 features are introduced.

## Deferred review watchpoints

- Before later visual/hybrid re-extraction augments existing text, design explicit extraction revisions so historical segments referenced by evidence remain immutable. Identical-byte version reuse remains acceptable for M2; extraction revisions are not implemented here.
- Before URL ingestion can be invoked autonomously by a model/agent, review and implement SSRF restrictions for private, loopback and link-local addresses, including redirect handling. M2 remains explicitly user-directed; no networking/security subsystem is added in this correction.

## M4 engineering choices

The user authorized assessment/evidence foundation after the M3 checkpoint, with no learner-model or later-milestone behavior. The pre-coding report specified these implementation details:

- Immutable task snapshots resolve the active or explicit historical curriculum once and validate course-owned concept membership. Optional source/version/segment and separate research references use existing read ports. Task creation is separate from response submission, not a question-bank feature.
- Attempts preserve supplied responses, explicit assistance/hints and optional confidence/latency/runtime references. Historical curriculum, targets, novelty and representation are exposed through the immutable task reference. Evidence audit joins these records rather than copying source text.
- A combined assessment repository provides snapshot transactions and atomic evaluation/evidence transactions. Attempts persist before evaluator invocation. Migration 5 is additive; migrations 1–4 are unchanged. Append-only triggers protect history, and parent-last inserts with deferred child foreign keys seal task mappings and rubric scores at commit.
- Scored evaluations carry finite normalized correctness; partial scores require a task-specific rubric with every criterion scored. Unscored evaluations have null correctness and can create explicitly unscored evidence. Failed invocations retain a failed evaluation but no event; a new operation ID permits later evaluation of that same attempt.
- Evaluators return bounded, strictly validated outcome proposals only. Unknown identity/learner-state fields are rejected. Trusted application code supplies evaluator identity and policy version; adapters cannot write repositories. M4 includes deterministic evaluation, human recording and fake open-response adapters, without live Pi LLM evaluation or provider calls.
- Text normalization, numeric tolerance and set duplicate behavior are explicit task data. Choice responses use known identifiers. Numeric parsing accepts a complete finite decimal only; numeric/choice/set malformed responses become unscored rather than fabricated correctness. No expression/proof/code execution or semantic equivalence is added.
- Assistance and novelty remain separate enums. Intended dimensions are metadata only. Confidence is 0–1, latency at most one day in milliseconds, and hint count at most 100; these bounds are input limits, not pedagogical thresholds.
- Course-scoped submission/evaluation operation IDs store SHA-256 fingerprints of canonical validated requests. Same request returns the original outcome, including failures; changed requests conflict. Manual evaluation fingerprints include the outcome, while evaluator invocation fingerprints include attempt/evaluator/policy and supersession, before a proposal exists.
- Corrections append same-attempt supersession links, never overwrite history. Existing-parent foreign keys, new IDs and update/delete prohibition prevent cycles. Audit exposes all terminal heads without selecting an authoritative grade or reconciling learner state.
- Pi supplies read-only attempt/evidence audit commands scoped to its existing session selection. No model-facing evidence writer is registered. Core services and evaluator contracts remain independent of Pi and SQL.
- Acceptance responses are explicitly synthetic. A read-only SQLite backup of the approved M3 Logic acceptance database supplies only existing structural/provenance linkage; all M4 writes occur in an ignored isolated copy. No learner performance claim results.
- No dependency, mastery/readiness, gap, review, diagnostic, teaching, web UI or OpenClaw component is added. Live open-response context assembly/provider execution remains deferred behind the port.
