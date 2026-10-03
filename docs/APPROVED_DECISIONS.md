# Approved architecture refinements

These user-approved decisions supplement `DESIGN_SPEC.md`, whose original contents are preserved.

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
