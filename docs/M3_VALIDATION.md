# M3 validation — curriculum and concept graphs

Validated on Windows, Node 24.19.0, pinned Pi 1.0.1. The approved baseline is `88a85bad1e81f1dc2568da4cc666264592475cfe`. M3 is uncommitted and awaits external review.

## Portable checks

`npm run check`: strict typecheck and **89 tests passed**, zero failures, cancellations or skips. Tests use synthetic evidence and fake networking; no live network or model credentials are required. The real Pi SDK loads curriculum commands and runs a restricted builder with a deterministic fake model turn. Both active and callable tool lists contain only the evidence reader and proposal tool.

Coverage includes concept reuse/new identity, draft/activation/history, chains/diamonds, prerequisite self/two-node/long cycles, allowed non-prerequisite cycles, runtime shape/bounds/unknown fields, exact provenance/ownership, source history, graph and activation rollback, restart, research rollback/failures, model injection boundaries, and closed/cancelled tool rejection. Security tests cover scheme/host/path/credentials/IP rejection, DNS private ranges and rebinding checks, TLS peer mismatch, safe headers, redirects/loops, size/content-type/encoding limits and deadlines.

Migration 4 adds concepts, curriculum versions/nodes/edges, current pointers, exact source provenance, research briefs/references and research provenance. Migrations 1–3 retain their approved SQL and checksums. No dependency or package file changed.

## Real Logic acceptance

Course: `course-e6418cf4-e61a-4d88-a414-1b96ce4f1e6a`. Curriculum v1 was created as a draft, validated, explicitly activated and reopened. Curriculum v2 changed presentation while reusing all stable concept IDs, retained v1 unchanged, was explicitly activated and survived another reopen.

| Source | ID | Version | Physical pages |
| --- | --- | --- | --- |
| CS208 (Semester 1) Topic 0 : Propositional Logic | `source-38ec3b4d-610b-48f4-94e2-28bbfb77f40b` | 1 | 91 |
| CS208 (Semester 1) Topic 1 : Entailment and Deduction | `source-223464d1-9140-4f81-890e-e1ce5779968b` | 1 | 60 |
| CS208 (Semester 1) Topic 2 : Proof for Propositional Logic | `source-cbbee22c-0019-4e44-9ad1-79e5cd372707` | 1 | 90 |

All 241 native PDF page segments were ingested. Relevant extracted definitions and rule summaries were inspected before constructing the compact proposal; no expected concept count was imposed. Results: **24 concepts**, **38 directed relationships**: 30 prerequisite, 2 represented-by, 2 confusable-with and 4 contrasts-with. The prerequisite subgraph is acyclic. Reciprocal satisfiability/validity and soundness/completeness relationships demonstrate that the overall graph is not a DAG.

Prerequisite roots: atomic statements, truth values, and inference rules/deduction trees. Representative map:

```text
Atomic statements → logical connectives → formula syntax → truth assignment
Truth values → valuations ────────────────────────────────┘
Truth assignment → truth tables → satisfiability / validity
Truth assignment → semantic entailment → soundness / completeness
Formula syntax + inference rules → proof judgements → focused judgements
Focused judgements → Done/Use → conjunction / implication / disjunction rules
Implication rules + False elimination → negation rules
Validity + disjunction rules + negation rules → excluded middle
Excluded middle → intuitionistic/classical distinction

Satisfiability ↔ validity                 [confusable_with]
Semantic entailment ↔ proof judgements    [contrasts_with]
Soundness ↔ completeness                 [contrasts_with]
```

Exact provenance examples:

- Formula syntax: Topic 0, source v1, physical PDF page 6 (`source-38ec3b4d-610b-48f4-94e2-28bbfb77f40b@1:5`)
- Valuations: Topic 0, source v1, physical PDF page 31 (`source-38ec3b4d-610b-48f4-94e2-28bbfb77f40b@1:30`); Topic 0, source v1, physical PDF page 35 (`source-38ec3b4d-610b-48f4-94e2-28bbfb77f40b@1:34`)
- Semantic entailment: Topic 1, source v1, physical PDF page 30 (`source-223464d1-9140-4f81-890e-e1ce5779968b@1:29`); Topic 1, source v1, physical PDF page 31 (`source-223464d1-9140-4f81-890e-e1ce5779968b@1:30`)
- Implication introduction/application: Topic 2, source v1, physical PDF page 41 (`source-cbbee22c-0019-4e44-9ad1-79e5cd372707@1:40`)
- Negation rules: Topic 2, source v1, physical PDF page 59 (`source-cbbee22c-0019-4e44-9ad1-79e5cd372707@1:58`); Topic 2, source v1, physical PDF page 62 (`source-cbbee22c-0019-4e44-9ad1-79e5cd372707@1:61`); Topic 2, source v1, physical PDF page 64 (`source-cbbee22c-0019-4e44-9ad1-79e5cd372707@1:63`)

Page numbers are physical M2 anchors, not printed slide labels. Prerequisite ordering is an instructional proposal for review, not a uniquely proven teaching order. Spatial proof trees and truth-table layouts were not reconstructed from flattened text. Detailed philosophy, complete worked derivations and unsupported misconceptions were omitted. An ambiguous completeness slide caption was handled using the implication direction and explicit counterexample; uncertainty was retained.

## Generated Python acceptance

Course: `course-229d6347-0f50-43a2-9098-bbf4056ce2f6`. Research brief: `brief-5b07c6ef-0fbf-4fe9-9234-ee8430ff49c5`. Six actual retrievals succeeded under the bounded adapter. The source selection favors authoritative tutorial definitions and concrete examples relevant to small scripts rather than a broader crawl. Returned page titles identify Python 3.14.8 documentation.

| Official page | Status | Retrieved UTC | HTML SHA-256 |
| --- | --- | --- | --- |
| [3. An Informal Introduction to Python — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/introduction.html) | ready | 2026-10-03T19:43:51.552Z | `f375723de7e24ada957727184dea7dfa639863ad3cedd9e58d3fec15a110f468` |
| [4. More Control Flow Tools — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/controlflow.html) | ready | 2026-10-03T19:43:51.680Z | `1c6a664f33685f707243d4a50903cc5811da6e25d946d4b2344994b1d27e007f` |
| [5. Data Structures — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/datastructures.html) | ready | 2026-10-03T19:43:51.794Z | `02e023ea83aa90779a21f507d6d1c573d994b28866d024557b11d94497a60b7d` |
| [6. Modules — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/modules.html) | ready | 2026-10-03T19:43:51.893Z | `32a9700d1b059a5aa6fb9fbfada7241c4efc66fbacf50cbec1dd51181f9896e0` |
| [7. Input and Output — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/inputoutput.html) | ready | 2026-10-03T19:43:51.976Z | `49ba6bd1375ce0066364a94ff253df32f1448c84717cb3c36a15322aa5ab017c` |
| [8. Errors and Exceptions — Python 3.14.8 documentation](https://docs.python.org/3/tutorial/errors.html) | ready | 2026-10-03T19:43:52.146Z | `39f032a3978a8e00cb97aa69b13f6a5f80109cd5226f65ed9da0bb37248c4fbd` |

Results: **15 concepts**, **23 relationships**: 20 prerequisite, 2 contrasts-with and 1 used-by. Values/expressions are the prerequisite root. Curriculum v1 and v2 demonstrated the same draft, explicit activation, restart, stable-identity and history-preservation checks as Logic.

```text
Values/expressions → variables → console input/output → file input/output
Values/expressions → Boolean conditions → branching → functions/parameters
Functions → returns and None → compose a small independent program
Functions → local/module scope → scripts/modules/imports → small program
Values/expressions → collections → iteration/loops → small program
Values/expressions → errors → exception handling → small program

Console output ↔ return values    [contrasts_with]
File input/output → small program [used_by, optional extension]
```

Representative provenance: values/assignment cite Introduction; branching/functions/returns cite Control Flow; conditions/collections cite Data Structures; scope cites Control Flow and Modules; scripts/imports cite Modules; files cite Input and Output; error handling cites Errors and Exceptions. All nodes reference successfully persisted brief/reference IDs. No learner-source origin was reused for these research records.

The tutorial assumes some familiarity with programming; absolute-beginner sequencing is synthesized and remains subject to approval. Installation, object-oriented programming, packaging and advanced features are deliberately omitted. File persistence is optional for the goal. Authority and successful retrieval do not automatically verify every proposed pedagogical dependency.

## Acceptance method and limits

`node scripts/validate-curriculum.ts prepare` performed real ingestion and real bounded retrieval. After evidence inspection, reviewed proposals were written only inside the ignored acceptance workspace and submitted by `complete` through the model-facing proposal tool. This proves genuine evidence/provenance, deterministic proposal validation and persistence; **it does not claim a live Pi model-provider completion**. No Pi authentication was configured here. Portable SDK tests separately exercise the model adapter using a deterministic fake turn.

Private manifests, extracted text, proposal JSON, databases and full reports remain beneath `_learning/m3-acceptance/`. Original learner PDF hashes were checked unchanged. This committed document contains only sanitized acceptance summaries and provenance metadata, not source text dumps or private graph drafts.

## Boundaries and review

The overall graph is not constrained to a DAG; only prerequisites are. Source provenance retains exact M2 versions/segments. Stable concepts survive presentation/version changes. Models can create validated drafts, cannot activate them, and cannot establish learner mastery. No learner-state semantics or M4 behavior were added.

New code is organized beneath `src/domain/`, `src/ports/`, `src/services/`, `src/persistence/`, `src/research/` and `src/runtime/pi/`; the existing composition root wires adapters. `scripts/validate-curriculum.ts` is explicit local acceptance, and the new portable tests/fixtures are synthetic. README and approved decisions describe genuine behavior. DESIGN_SPEC is unchanged.

`git diff --check` and the final complete review artifact are verified before delivery. `m3-review.diff` is relative to the exact M2 checkpoint, includes tracked and untracked M3 files, and excludes private/runtime artifacts. No commit or M4 work is performed.

## Complete M3 file inventory

Modified tracked files:

- `.pi/extensions/index.ts`
- `README.md`
- `docs/APPROVED_DECISIONS.md`
- `src/persistence/database.ts`
- `src/persistence/migrations.ts`
- `tests/pi-integration.test.ts`
- `tests/source-persistence.test.ts`

New M3 files:

- `docs/M3_VALIDATION.md`
- `scripts/validate-curriculum.ts`
- `src/domain/curriculum.ts`
- `src/domain/proposal-validation.ts`
- `src/domain/research.ts`
- `src/persistence/graph-repository.ts`
- `src/persistence/migration-4.ts`
- `src/persistence/research-repository.ts`
- `src/ports/graph-repository.ts`
- `src/ports/research.ts`
- `src/research/official-docs.ts`
- `src/runtime/pi/curriculum-builder.ts`
- `src/runtime/pi/curriculum-tools.ts`
- `src/runtime/pi/register-curriculum.ts`
- `src/services/graph-service.ts`
- `src/services/research-service.ts`
- `tests/curriculum-builder.test.ts`
- `tests/curriculum-tools.test.ts`
- `tests/graph-domain.test.ts`
- `tests/graph-persistence.test.ts`
- `tests/graph-service.test.ts`
- `tests/helpers/graph-fixtures.ts`
- `tests/research-persistence.test.ts`
- `tests/research-security.test.ts`

The review diff is an additional temporary artifact; it is not part of the implementation inventory.
