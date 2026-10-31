# Personal Learning Engine

A local learning assistant that turns study material into a versioned curriculum, guides practice, and schedules follow-up reviews. Built in **TypeScript** with **SQLite**, running as an extension for the [Pi coding agent](https://github.com/earendil-works/pi).

The central design problem is separating what an AI generates from what a learner has actually demonstrated. Models propose teaching content; validated application services record answers and evidence, calculate learner state, and decide when another observation is due. Completing a lesson or waiting long enough never establishes competence by itself.

## What it does

- **Source-grounded learning:** ingest PDF, PPTX, Markdown, text, static HTML and supplied YouTube captions, with version hashes and page/slide/section/timestamp anchors.
- **Curriculum graphs:** build, inspect, validate and explicitly activate a curriculum with stable concept identities and prerequisite relationships.
- **Practice and evidence:** run diagnostic and teaching sessions, retain submitted answers, and preserve an auditable assessment history.
- **Deterministic review:** derive readiness and gaps from recorded evidence and schedule independent follow-up observations.
- **Obsidian workspace:** export linked concept notes, provenance and review information while preserving designated personal annotation sections. SQLite remains the source of truth.

This is a personal portfolio project with a terminal interface. It is not a hosted application. Generated content still requires human review; educational effectiveness has not been established by the automated tests.

## Try it locally

Use **Node 24.19.0 or a later Node 24 patch** and npm. Windows is the locally validated platform; other operating systems have not been verified. No separate database server is needed.

From the project directory:

```powershell
npm ci --ignore-scripts
npm run check
npm run dev
```

The extension uses the pinned local Pi executable. Accept Pi's project-trust prompt if shown. Inside Pi, try this small public example:

```text
/learning-status
/course new source_grounded "Boolean Logic Demo" "Understand conjunction and negation"
/course list
```

Copy the complete course ID from the output, then replace `course-<UUID>` below:

```text
/course use course-<UUID>
/source add sources/examples/boolean-logic.md
/source list
/source search "conjunction"
/learning-help
```

These inspection and ingestion commands work without model credentials. The [demo source](sources/examples/boolean-logic.md) is synthetic and safe to share. Tests also use synthetic fixtures and require no provider credentials or live model calls.

To try AI curriculum generation, configure a model/provider in Pi using its `/login` and `/model` commands, then run:

```text
/curriculum build
/curriculum show 1
/curriculum validate 1
/curriculum activate 1
/diagnostic start
/diagnostic next
```

Activate version 1 only after inspecting the draft; use the actual version number if you have built more than one. Follow the [usage guide](docs/USAGE.md) for JSON answer syntax, teaching, reviews, Obsidian export and recovery. Reselect your course after restarting Pi.

Runtime data is created in the ignored `_learning/` directory. Put your own source files in ignored `sources/inbox/` or `sources/courses/`.

**Privacy:** with a cloud model configured, bounded source excerpts and relevant course/learner-response context may be sent to that provider. Local storage does not imply that AI generation stays on-device. Keep credentials in Pi's provider configuration, outside this repository.

## Engineering decisions

| Decision | Purpose |
| --- | --- |
| Domain policies, service layer, ports and adapters | Keep learning rules independent of Pi and SQLite; architecture tests enforce the import boundaries. |
| Built-in Node SQLite, transactions and checksum-verified migrations | Persist course and session history without a separate database service; reject incompatible migration history. |
| Immutable source versions and append-only performance history | Preserve the provenance of past tasks and make corrections auditable. |
| Restricted model sessions and validated proposals | Let models generate content without giving them direct authority to record competence or change review schedules. |
| Explicit assistance and novelty metadata | Distinguish independent performance from hinted, repeated or AI-performed work. |
| Idempotent operations and resumable workflows | Retain submitted answers through evaluator failures and recover sessions after restart. |

Source retrieval combines SQLite FTS5/BM25 with literal matching for mathematical symbols. Generated research is currently restricted to six approved Python tutorial pages, with bounded fetching and public-address checks; it is not an arbitrary-topic web researcher.

```text
.pi/extensions/index.ts   Composition root and Pi session lifecycle
src/runtime/pi/          Commands and model adapters
src/services/            Application workflows
src/domain/              Types and deterministic policies
src/ports/               Infrastructure contracts
src/persistence/         SQLite repositories and migrations
src/ingestion/           Source readers and parsers
src/exports/obsidian/    Private vault export
sources/examples/        Public synthetic demo
scripts/                 Optional local acceptance harnesses
tests/                   Unit, integration, security and recovery tests
```

## Validation and current limits

`npm run check` runs strict TypeScript checking and Node's built-in test runner. The locally verified suite has **332 passing tests**, covering domain rules, persistence, parsers, Pi extension loading, architecture boundaries, recovery and security cases. The included GitHub Actions workflow runs the same checks on Windows; its first hosted result will be available after publication.

```powershell
npm run typecheck
npm test
```

Tests exercise real services and the Pi SDK with controlled fixtures; they do not establish live model quality or learning outcomes. Local acceptance scripts under `scripts/` are separate from CI and some require private material; they are not needed to run the public example or test suite.

Current constraints include:

- Closed text/choice/numeric/set grading; no semantic open-response grader, proof checker or code execution evaluator.
- PDF native-text extraction only: no OCR or visual interpretation of diagrams and formulas. YouTube ingestion requires explicitly supplied captions.
- A deterministic review ladder of 3, 7, 14, 30 and 60 days; no fitted forgetting model or background notifications.
- One-way Obsidian export; editing a note cannot change recorded performance or competence.

## Further reading

- [Usage and command reference](docs/USAGE.md)
- [Design specification](docs/DESIGN_SPEC.md) and [engineering decisions](docs/APPROVED_DECISIONS.md)
- [Core integration validation](docs/M9_VALIDATION.md) and [Obsidian validation](docs/OBSIDIAN_V1_VALIDATION.md)
- [File inclusion review and GitHub publishing steps](docs/PUBLISHING.md)

Milestone documents retain development-checkpoint context; use this README for the current project overview.
