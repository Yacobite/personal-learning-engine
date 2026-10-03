# Personal learning engine — M0 foundation

This repository currently provides only TypeScript boundaries, SQLite initialization/migrations, and a Pi diagnostic command. Course management and all learning features await later milestone approval.

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

Database initialization occurs on `session_start`, creating `_learning/learning.db`. `_learning/` is ignored by Git. The only table is `schema_migrations`; no course/learner schema exists yet. Extensions run with the current user's permissions; the path checks are not an operating-system sandbox.

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

The Pi SDK smoke test verifies loading and command dispatch without a terminal. Terminal appearance and provider authentication are not exercised by automated tests. The next milestone is M1 course management, which has not begun.
