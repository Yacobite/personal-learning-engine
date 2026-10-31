# Personal Learning Engine

A learning bot built with TypeScript and SQLite that runs in the terminal through [Pi](https://github.com/earendil-works/pi).

The idea is to take study notes, turn them into a course, and use questions and reviews to help work through it. I wanted progress to be based on answers, rather than just marking a topic as finished.

## What it does

- Reads study material from PDFs, PowerPoint slides, Markdown, text and web pages.
- Builds a course with topics and prerequisites that you can check before using.
- Runs practice sessions and keeps a history of answers and feedback.
- Tracks gaps and schedules follow-up reviews.
- Exports linked study notes to Obsidian, with space for your own notes.

## Built with

- TypeScript
- SQLite for local storage
- Pi for the terminal interface and AI integration
- Node's built-in test runner

The learning rules are separate from the AI and database code. AI generates content, while the application handles saving answers, tracking progress and scheduling reviews.

## Running it

You'll need **Node 24.19.0 or a later Node 24 patch**. I've tested it on Windows.

From the project folder in PowerShell, run:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

Accept Pi's project-trust prompt if it appears. Once Pi opens, enter:

```text
/learning-help
```

To try the included example without setting up an AI provider:

```text
/course new source_grounded "Boolean Logic Demo" "Understand conjunction and negation"
```

Copy the course ID from the output and replace `course-<UUID>` below with it:

```text
/course use course-<UUID>
/source add sources/examples/boolean-logic.md
/source search "conjunction"
```

For AI-generated courses and teaching, use `/login` and `/model` in Pi to configure a provider. The [usage guide](docs/USAGE.md) covers the full workflow.

Your learning data stays in `_learning/`, which is ignored by Git. Put your own study files in `sources/inbox/` or `sources/courses/`, which are also ignored. If you use a cloud AI provider, relevant study material and answer context may be sent to it.

## Tests

```powershell
npm.cmd run check
```

This runs the TypeScript checks and test suite. There are **332 tests**, covering things like saving data, reading sources, review scheduling and recovering interrupted sessions. They don't need AI credentials.

## Current limitations

This is still a personal project. Generated teaching content needs checking, and it can't reliably grade open-ended explanations. PDFs need selectable text because there's no OCR or diagram reading yet. Obsidian export is one-way, so editing a note doesn't update your progress.

More detail is in the [usage guide](docs/USAGE.md), [design notes](docs/DESIGN_SPEC.md) and [engineering decisions](docs/APPROVED_DECISIONS.md).
