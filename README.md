# Personal learning engine — M2 source ingestion and local retrieval

This repository provides durable courses and versioned, locally searchable sources through Pi. M2 retrieves source material; teaching and learner-model features await later milestone approval.

The authoritative product specification is [docs/DESIGN_SPEC.md](docs/DESIGN_SPEC.md). Approved refinements and engineering choices are in [docs/APPROVED_DECISIONS.md](docs/APPROVED_DECISIONS.md).

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

Database initialization occurs on `session_start`, creating `_learning/learning.db`. `_learning/` is ignored by Git. Schema version 3 adds `sources`, `source_versions`, `source_segments`, and `source_segments_fts` beside the migration ledger and courses. No learner-model schema exists yet. Extensions run with the current user's permissions; the path checks are not an operating-system sandbox.

## Courses

Create a course with its mode, title, and objective:

```text
/course new source_grounded "Propositional Logic" "Understand the module"
/course list
/course use course-<UUID shown by new or list>
/course current
```

Modes are `source_grounded` (supplied course material), `generated_curriculum` (a goal with externally researched material), and `hybrid` (both). The mode does not change during ingestion. Curriculum generation is not implemented.

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

The Pi SDK integration tests verify loading and course/source command flows without a terminal or model call. Terminal appearance and provider authentication are not exercised. Synchronous SQLite writes remain short application transactions; extraction/fetching is async outside them, though native PDF/PPTX parsing can occupy the local runtime. M2 is awaiting external review. M3 has not begun.
