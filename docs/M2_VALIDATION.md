# M2 validation

M1 baseline: `ff9233fbd200ab6c275511437a0cdadfa00cc8cc`. M2 remains uncommitted for external review.

## Real Logic material

Validated using `node scripts/validate-logic.ts` on Node 24.19.0/Windows x64, through the pinned Pi 1.0.1 SDK. The run copies supplied files into an isolated ignored workspace; original hashes remain unchanged. No credentials or model conversation were used.

| Original | Extracted document title | Physical PDF pages | Segments | Page-specific warnings |
| --- | --- | ---: | ---: | --- |
| topic0.pdf | CS208 (Semester 1) Topic 0 : Propositional Logic | 91 | 91 | None below the sparse-text threshold |
| topic1.pdf | CS208 (Semester 1) Topic 1 : Entailment and Deduction | 60 | 60 | None below the sparse-text threshold |
| topic2.pdf | CS208 (Semester 1) Topic 2 : Proof for Propositional Logic | 90 | 90 | None below the sparse-text threshold |

All three are `ready_with_warnings`, retaining the native-text-only visual limitation. The absence of sparse-page warnings does not establish formula, diagram or table fidelity.

Observed search results (all source version 1):

| Literal term | Returned physical-page anchors, in ranked order |
| --- | --- |
| implication | Topic 2: 41, 64 |
| proposition | Topic 2: 78, 79, 80, 82, 83 |
| truth | Topic 0: 27, 35, 39, 26, 73 |
| formula | Topic 0: 50, 75, 79, 80, 81 |
| natural | Topic 2: 31, 2, 29, 12, 27 |

Terms were chosen from actual extracted text. The report preserves source IDs, version IDs, ranks and typed anchors. Physical Topic 2 page 41 was also rendered and inspected: it contains implication proof rules but prints “page 25 of 56”. PDF slide builds explain the difference. Its extracted symbols flatten the proof-rule arrangement, demonstrating why the persisted visual warning matters. The temporary rendering remains under ignored `_learning/`; no rendering/vision pipeline was added to the product.

## Exercised command flow

```text
/course new source_grounded "Logic M2 acceptance" "Inspect real course sources"
/course use <created-course-id>
/source add sources/inbox/topic0.pdf
/source add sources/inbox/topic1.pdf
/source add sources/inbox/topic2.pdf
/source list
/source search "implication"
```

`list` returned all three titles, source IDs, version 1, PDF kind, learner-file origin and warning status. Search returned Topic 2 physical pages 41 and 64 with source/version identity and page text. Complete private command outputs are saved in `_learning/m2-acceptance/report.json`.

After session shutdown/start, active selection was empty. Selecting the same persistent course restored the source list and search. Re-ingesting Topic 0 returned `Unchanged ... v1`; version 2 did not exist. An independent controlled TXT fixture changed from implication text (v1) to equivalence text (v2); both historical texts remained addressable, and current search used v2. Originals were never edited.

## Persistence and dependencies

Migration 3, `versioned-sources-and-fts`, adds `sources`, `source_versions`, `source_segments`, `source_segments_fts`, and lookup indexes. Source/version foreign keys and transactional writes keep the current pointer, history and index consistent. Fixed checksums prove migrations 1 and 2 unchanged; M1 ledger rows and courses survive upgrade.

Direct additions: `pdfjs-dist@6.4.299`, `fflate@0.8.3`, `htmlparser2@12.0.0`. PDF.js retains optional `@napi-rs/canvas@1.0.10` and Windows x64 binary `@napi-rs/canvas-win32-x64-msvc@1.0.10`. Install scripts were disabled. Exact transitives are in `package-lock.json`.

## Portable checks

`npm run check` typechecks all production, test and acceptance-script TypeScript and runs the complete Node test suite. Coverage includes original M0/M1 checks, immutable migration history, source IDs/anchors/status, parser selection, safe local paths/original preservation, PDF empty pages, PPTX slide/notes order, Markdown hierarchy/fences/bounded text, controlled HTML/redirects/credential omission, available/unavailable caption fixtures, failure rollback, restart/version history, current-version FTS, course/source isolation, and real Pi command delegation without credentials. Public websites and private PDFs are not portable CI dependencies.

Final result after review corrections: **45 passed, 0 failed, 0 skipped**; strict typecheck passed. This includes 21 existing M0/M1 checks, one additional parser boundary check, four input/security checks, nine domain/parser checks, three source-persistence checks, and seven source-service/retrieval checks. `git diff --check` also passed. A rollback test fails after a segment and FTS entry have already been inserted, proving neither remains; a failed update also preserves the prior current version and search results.

## Targeted external-review corrections

- Local identity/provenance is now project-relative, for example `sources/inbox/input.txt`. Tests verify absolute/relative references, normalized separators, Windows casing, equivalent paths in separate workspace roots, and existing traversal/symlink protections.
- Realistic synthetic Logic text contains `¬P; P ∧ Q; P ∨ Q; P → Q; P ↔ Q; P ⊨ Q; P ⊢ Q; α × β`. Literal queries retrieve these operators, including `¬`, `→`, `⊨` and `⊢`. Mixed `P → Q` excludes word-only `P Q` and different-operator `P ⊨ Q` distractors while retaining FTS/BM25 ranking. Tests cover symbol-only and mixed queries, course/source isolation, old-version exclusion, stable ordering, full provenance, and SQL/FTS injection attempts.
- Migration 3 rejects invalid source IDs and blank identities even through direct SQLite inserts bypassing the service. Its source-ID CHECK enforces lowercase hexadecimal, UUID version/variant, and exact hyphen positions. Fixed M1 checksum tests still protect migrations 1 and 2.
- Explicit extraction revisions and autonomous-ingestion SSRF protection remain documented future requirements; neither is implemented here.

Private originals, copies, database, report and image are ignored; only `sources/inbox/.gitkeep` is a source-directory Git candidate. Nothing has been staged or committed. No M3 work is included.
