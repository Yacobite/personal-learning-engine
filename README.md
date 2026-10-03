# Personal learning engine — M1 durable courses

This repository provides the engineering foundation and durable course management through Pi. Content ingestion and learning features await later milestone approval.

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

Database initialization occurs on `session_start`, creating `_learning/learning.db`. `_learning/` is ignored by Git. The tables are `schema_migrations` and `courses`; no learner schema exists yet. Extensions run with the current user's permissions; the path checks are not an operating-system sandbox.

## Courses

Create a course with its mode, title, and objective:

```text
/course new source_grounded "Propositional Logic" "Understand the module"
/course list
/course use course-<UUID shown by new or list>
/course current
```

Modes are `source_grounded` (supplied course material), `generated_curriculum` (a goal with externally researched material), and `hybrid` (both). M1 stores the mode only; it does not ingest material or generate a curriculum.

Double-quote arguments containing spaces. Quoted strings accept JSON escapes such as `\"` and `\\`. `/course new` without arguments shows usage. Empty titles/objectives, invalid modes, malformed IDs, and missing courses produce errors.

IDs are `course-` followed by a lowercase UUID v4. They are independent of titles; duplicate titles are allowed. Copy the complete ID printed by creation or listing. Creating a course does not automatically select it.

**Selection is session-scoped:** each live Pi session keeps its own active course ID in memory. Session shutdown, replacement, reload, or application restart clears the selection. Course records persist in SQLite across restart. Select a course again with `/course use`. No global current-course preference is stored.

Native Windows can use Pi's optional PowerShell tool; Pi's `!` shell commands require Bash. M0 diagnostics need neither shell tool. See the [Pi Windows guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/windows.md).

## Boundaries

```text
.pi/extensions/index.ts       composition and session lifecycle
src/runtime/pi/               Pi command registration and presentation
src/services/                 application operations
src/ports/                    infrastructure contracts
src/domain/                   runtime-independent types
src/persistence/              SQLite and migrations
```

The service accepts a store interface. Domain, ports, and services cannot import Pi or persistence; an AST-based test enforces the inward dependency direction.

## Migrations

Add an ordered, consecutive migration in `src/persistence/migrations.ts` when a milestone requires schema changes. Never edit an already applied migration. Initialization validates recorded checksums and rejects unknown history; pending migrations run in one transaction. A failed migration rolls back its changes and ledger writes. Future destructive migrations require backups and prior-version fixtures as specified in the design.

## Scope and tradeoffs

Built-in SQLite avoids another database package and native Windows addon installation. Its APIs are synchronous; foundation queries are short. Only the APIs verified on the supported Node runtime are used. Node's SQLite stability designation can vary by Node patch; do not assume compatibility outside the declared Node 24 range.

The Pi SDK integration test verifies loading and the course command flow without a terminal or model call. Terminal appearance and provider authentication are not exercised by automated tests. M1 is awaiting external review; M2 has not begun.
