# Unified Personal Learning Engine
## System Design Specification v1.0

**Status:** Architecture baseline for implementation  
**Primary runtime:** Pi (initially)  
**Implementation workflow:** Design/review in ChatGPT; repository implementation in Codex  
**Optional later distribution layer:** OpenClaw  
**Document purpose:** Define the complete product, pedagogy, architecture, data model, workflows, interfaces, quality gates, and implementation roadmap for a personal AI learning engine that combines the strongest ideas from Eero Alvar's `learn` system, Kruthvik's Sato, and the referenced active-recall / spaced-repetition study workflows.

---

# 1. Executive summary

We are building a **personal learning engine**, not a generic chatbot and not a note summarizer.

The system should be able to handle both of these equally well:

1. **Source-grounded learning**: the learner drops in university material such as lecture slides, PDFs, notes, old exams, a syllabus, a website, or a video, and the engine teaches that material using the course's terminology, notation, scope, and assessment expectations.
2. **From-scratch learning**: the learner gives only a goal such as "teach me Python from zero", and the engine researches a trustworthy curriculum, builds a prerequisite graph, teaches it interactively, measures learning from demonstrated performance, and schedules later review.

The engine is designed around one core idea:

> The AI should remove logistical friction, not cognitive effort.

It should do the boring work - source gathering, curriculum mapping, prerequisite ordering, fact checking, question generation, state tracking, review scheduling, and visualization - so that the learner can spend their effort on the things that create learning: understanding, retrieval, discrimination, application, explanation, debugging, and transfer.

The system must never confuse **being shown an explanation** with **knowing it**. Learner self-report controls pacing and presentation; demonstrated performance controls mastery state.

The initial implementation should be a **Pi package/project configuration**, not a fork of Pi. Pi provides the agent loop, sessions, tools, skills, extensions, UI primitives, and programmatic integration. Our learning engine owns the pedagogy and all durable learning data. OpenClaw may later sit above it as a channel/automation layer, but must not own the learning model. Codex is the preferred implementation agent for building the repository, but is not a runtime dependency.

---

# 2. Source material and what we are taking from each source

This design is a synthesis, not a literal merge. We keep the strongest principles and discard accidental complexity.

## 2.1 Eero Alvar video: "How I Use AI to Learn Things"

Reference: https://www.youtube.com/watch?v=kzcI5F4tGiU

Key ideas to preserve:

- A good learning system approximates a **one-to-one teacher / one-to-one learner relationship**.
- The system should locate the learner's **knowledge frontier**, rather than teaching too low or too high.
- The core macro-flow is **Probe -> Plan -> Teach**.
- Probing should adapt in difficulty and, for learners with prior knowledge, can binary-search the boundary between reliable knowledge and the first failures.
- The plan should be a **dependency graph**, not merely a list of chapters.
- Facts and foundations should be verified before they are used as roots for downstream reasoning.
- Teaching should proceed in small steps and regularly require learner output.
- Visuals should be used when they genuinely make a relationship, flow, or geometry clearer.
- The system should reduce the effort of finding resources, planning order, switching teaching styles, and fact-checking; it should not eliminate productive struggle.

## 2.2 `amosblomqvist/learn`

Reference: https://github.com/amosblomqvist/learn

Key ideas to preserve:

- Pi-native architecture using skills, TypeScript extensions, and specialized agents.
- A teaching philosophy based on connected knowledge and explicit dependencies.
- "Unconditional truths first": begin from facts/definitions the learner can safely accept, then derive dependent ideas explicitly.
- Separate tools for graded questions versus preference/goal questions.
- Probe every relevant prerequisite strand, not just one broad skill.
- Build a small dependency DAG and show it before extended teaching.
- Per-node teaching: **motivate -> establish/derive -> connect -> check**.
- Researcher subagent for factual verification.
- Mermaid/SVG maker agents with a **render -> visually inspect -> revise -> publish** loop.
- Markdown/Obsidian-friendly session logs and visuals.

Important modification for our system:

- The original `learn` skill says probing should never be skipped. We keep aggressive probing for learners who plausibly have prior knowledge, but combine it with Sato's novice handling: a genuine cold-start learner should not be repeatedly tested on material they could not know yet.

## 2.3 `kruthvik/sato`

Reference: https://github.com/kruthvik/sato

Key ideas to preserve:

- Learning state is **multidimensional**, not a single "mastery percentage".
- Separate learner self-report from observed evidence.
- Structured learning modes: deep mastery, fast learning, deadline/cram, exam drill, project-based learning.
- Session contracts can include objective, time budget, deadline, output, retention horizon, and permitted tools.
- Cold-start diagnosis avoids over-testing a novice and moves into worked examples after a small number of foundation checks.
- Core technique loop: predict, explain, retrieve, discriminate, apply, teach-back, repair.
- Scaffolding should fade: worked example -> completion problem -> independent problem.
- Active misconceptions deserve explicit refutation and counterexample testing.
- A genuine Feynman/teach-back process can use a "student" subagent carrying plausible misconceptions.
- **Gap escrow**: a mistake cannot be declared fixed merely because the learner succeeds immediately after being told the answer. Repair must later survive an independent parallel case after separation.
- Same-session success is provisional; durable mastery needs delayed evidence.
- Spaced review should schedule more than flashcards: facts, explanations, procedures, discrimination tasks, representations, transfer cases, and simulations.
- Source inspection must precede claims about course scope.
- Small questions should stay small; the full study protocol should not hijack simple clarifications.

Important modification for our system:

- Sato itself warns that its current implementation accumulated overhead and is being redesigned. Therefore we adopt the learning principles but rebuild the architecture cleanly around explicit domain objects, interfaces, migrations, and tests.

## 2.4 Ali Abdaal video: "How to study for exams - Evidence-based revision tips"

Reference: https://www.youtube.com/watch?v=ukLnPbIffxE

Key ideas to preserve:

- **Active recall / retrieval practice** should dominate passive rereading, highlighting, and copying notes.
- Revision should repeatedly require the learner to produce an answer from memory.
- Notes should be converted into questions wherever useful.
- The system should avoid making passive consumption feel like progress.

## 2.5 Ali Abdaal video: "How to Study for Exams - Spaced Repetition"

Reference: https://www.youtube.com/watch?v=Z-zNHHpXoMM

Key ideas to preserve:

- Retrieval should be **spaced**, not massed into one sitting.
- Review intervals should adapt as memory becomes stronger or weaker.
- The engine should prioritize what is due / weak rather than rely on a rigid forward-only timetable.
- Same-session retrieval still matters, but it is not evidence of long-term durability.

## 2.6 Ali Abdaal video: "Study Tips - How to learn new content"

Reference: https://www.youtube.com/watch?v=fBXnxlLR0PY

Key ideas to preserve:

- "Understanding" and "remembering" are related but distinct problems.
- A useful test of understanding is whether the learner can explain the idea competently and answer follow-up questions.
- Active recall should begin during first-pass learning, not only during later revision.
- After a short chunk of learning, the learner should reconstruct the key idea in their own words before looking back.

## 2.7 Ali Abdaal video: "How my friend ranked 1st at Medical School - The Active Recall Framework"

Reference: https://www.youtube.com/watch?v=fDbxPVn02VU

Key ideas to preserve:

- Convert source material into a **question bank** rather than only polished notes.
- Use the questions as the primary revision interface.
- Attempt answers from memory first; then look up misses in the original context.
- Focus future effort on misses and weak questions.
- Repeated retrieval should replace repeated passive rewriting.

---

# 3. Product vision

The final product should feel like a persistent private tutor that knows:

- what the learner is trying to achieve;
- what source material defines the course;
- what concepts depend on what;
- what the learner has actually demonstrated;
- where their misconceptions and weak boundaries are;
- what should be taught next;
- what should be reviewed today;
- how much help was needed on each attempt;
- whether a success was immediate, assisted, transferred, or delayed;
- which notation and conventions the learner's course expects;
- what the learner prefers in explanation style without treating preference as proof of competence.

The engine should support a conversation such as:

> "Here are my Logic lecture slides and the module website. I have finished Topic 0. Teach me Topic 1."

and also:

> "I want to learn Python from zero. I have no course material. Build me a path and teach me until I can build projects independently."

Both should end up flowing through the same learning-state machinery.

---

# 4. Non-goals

V1 is **not** intended to be:

- a general-purpose autonomous assistant;
- a replacement for every note-taking app;
- a social network or classroom LMS;
- a giant collection of AI-generated lectures;
- a system that declares mastery from confidence or chat fluency;
- a system that writes assessed projects for the learner and then treats the build as learning;
- a system that blindly converts every paragraph into a flashcard;
- a system that depends on one model vendor;
- a fork that permanently couples the learning data model to Pi internals;
- a full web product before the core pedagogy works.

---

# 5. Design principles

## 5.1 Performance beats self-report

Self-report can say:

- "I think I know this."
- "That explanation was confusing."
- "I prefer hints."
- "Go faster."

It can change presentation and probing strategy. It cannot establish mastery.

Mastery state changes only through evidence from learner performance.

## 5.2 Sources beat model memory

When source-grounded material exists, the engine should prioritize:

1. Learner/course-provided material.
2. Verified authoritative sources.
3. Reputable secondary sources.
4. Model prior knowledge as explanation glue, never as the sole authority when a claim can be verified.

If external sources disagree with course notation or a lecturer's convention, the engine should distinguish:

- **fact conflict**: surface and resolve it;
- **notation/convention difference**: preserve the course convention while explaining alternatives when useful.

## 5.3 Understanding is a graph

Knowledge is modeled as dependencies and relationships, not a flat list of chapters.

Nodes can include:

- concepts;
- definitions;
- facts;
- procedures;
- representations;
- derived results;
- misconceptions;
- boundary/failure cases;
- transfer targets;
- assessment objectives.

Edges can include:

- prerequisite-of;
- derives-to;
- confusable-with;
- representation-of;
- counterexample-to;
- used-by;
- transfer-of.

## 5.4 Productive difficulty is intentional

The system should make retrieval, application, debugging, explanation, and strategy selection effortful enough to create learning.

The system should remove useless friction such as:

- manually hunting for the right page;
- deciding which prerequisite to study first;
- repeatedly organizing question banks;
- remembering review dates;
- fact-checking definitions;
- finding a diagram tool;
- tracking which mistakes already occurred.

## 5.5 Small questions stay small

A user asking "what do the double brackets mean?" should get a direct explanation.

Do **not** create a full course session, concept graph, diagnostic battery, or mastery claim for every micro-question.

Structured mode activates for sustained study, explicit "teach me" requests, exams, review sessions, or projects.

## 5.6 Evidence quality matters

A correct answer can have very different value depending on whether it was:

- recognized from options;
- recalled freely;
- solved with a hint;
- solved after a worked example;
- solved independently;
- solved in a changed context;
- solved after a delay;
- solved under realistic time pressure.

The engine must store these differences rather than flattening all success into one number.

## 5.7 No fake precision

Dimension scores are estimates with uncertainty and evidence counts. They are not psychological ground truth.

The UI should prefer statements such as:

- "retrieval has 4 independent observations; transfer is untested"
- "understanding looks strong but has no delayed verification"

instead of false certainty such as "87.3% mastered".

## 5.8 Provenance everywhere

Every generated curriculum node and source-grounded concept should know where it came from.

Every learner-facing factual claim that is central or contested should be traceable to a source.

---

# 6. Runtime and toolchain decision

## 6.1 Pi is the initial runtime

Use Pi as the host because it already provides:

- interactive agent sessions;
- TypeScript extensions;
- custom tools and commands;
- skills;
- session persistence;
- custom TUI components;
- package distribution;
- SDK and RPC integration for later UIs.

The learning engine should be packaged so Pi can load it, but the core learning data and domain logic must live in our own modules.

## 6.2 Do not fork Pi in V1

Reasons:

- easier upgrades;
- smaller maintenance surface;
- separates our product from runtime internals;
- encourages clean interfaces;
- makes migration to another agent host possible later.

Fork only if a proven hard requirement cannot be implemented through public extension/package interfaces.

## 6.3 Codex is the implementation environment, not the product runtime

Recommended workflow:

- This design document defines product behavior and architecture.
- Codex receives bounded implementation tasks against this spec.
- Codex creates/refactors/tests the repository.
- Architecture changes come back through design review rather than being improvised during a large generation pass.

## 6.4 OpenClaw is optional later

OpenClaw is useful if we later want:

- Discord / WhatsApp / Telegram / Slack entry points;
- scheduled reminders and review notifications;
- persistent gateway automation;
- remote access to the tutor;
- orchestration of external runtimes.

It should sit **above** the learning engine as a delivery/automation layer.

OpenClaw must not become the canonical storage for mastery, gaps, concept graphs, or review state.

---

# 7. High-level architecture

```text
                           +-------------------------+
                           |       LEARNER UI        |
                           | Pi TUI first; web later |
                           +------------+------------+
                                        |
                              natural language + UI
                                        |
                           +------------v------------+
                           |   SESSION ORCHESTRATOR  |
                           | goal / mode / time /    |
                           | deadline / retention    |
                           +------------+------------+
                                        |
         +------------------------------+------------------------------+
         |                              |                              |
+--------v---------+          +---------v---------+          +---------v---------+
| CONTENT / SOURCE |          | PEDAGOGY ENGINE   |          | LEARNER MODEL     |
|      ENGINE      |          | probe/plan/teach  |          | evidence/gaps/    |
| ingest/index/RAG |          | assess/repair     |          | review/readiness  |
+--------+---------+          +---------+---------+          +---------+---------+
         |                              |                              |
         +------------------------------+------------------------------+
                                        |
                           +------------v------------+
                           |  DURABLE DOMAIN STORAGE |
                           | SQLite + manifests +    |
                           | human-readable exports  |
                           +------------+------------+
                                        |
                      +-----------------+------------------+
                      |                                    |
             +--------v---------+                +---------v---------+
             | SPECIALIST AGENTS|                | OPTIONAL LAYERS   |
             | researcher       |                | OpenClaw channels |
             | curriculum      |                | future web UI     |
             | student         |                | Anki/export       |
             | visual makers   |                | calendar alerts   |
             +------------------+                +-------------------+
```

---

# 8. Proposed repository layout

```text
learning-engine/
|
|-- .pi/
|   |-- skills/
|   |   |-- teach/SKILL.md
|   |   |-- curriculum/SKILL.md
|   |   |-- source-ingest/SKILL.md
|   |   |-- scaffold/SKILL.md
|   |   |-- visualize/SKILL.md
|   |   |-- exam/SKILL.md
|   |   `-- project/SKILL.md
|   |
|   |-- extensions/
|   |   |-- course-manager.ts
|   |   |-- content-ingest.ts
|   |   |-- source-search.ts
|   |   |-- graph-tools.ts
|   |   |-- quiz.ts
|   |   |-- explain.ts
|   |   |-- activity.ts
|   |   |-- evidence.ts
|   |   |-- gap-engine.ts
|   |   |-- review-scheduler.ts
|   |   |-- learning-session.ts
|   |   |-- md-log.ts
|   |   `-- visual-tools/
|   |
|   `-- agents/
|       |-- researcher.md
|       |-- curriculum-builder.md
|       |-- source-auditor.md
|       |-- student.md
|       |-- mermaid-maker.md
|       `-- svg-maker.md
|
|-- src/
|   |-- domain/
|   |   |-- course.ts
|   |   |-- source.ts
|   |   |-- concept.ts
|   |   |-- evidence.ts
|   |   |-- gap.ts
|   |   |-- review.ts
|   |   `-- session.ts
|   |-- services/
|   |   |-- course-service.ts
|   |   |-- ingestion-service.ts
|   |   |-- retrieval-service.ts
|   |   |-- graph-service.ts
|   |   |-- mastery-service.ts
|   |   |-- gap-service.ts
|   |   |-- review-service.ts
|   |   `-- export-service.ts
|   |-- persistence/
|   |   |-- db.ts
|   |   |-- migrations/
|   |   `-- repositories/
|   |-- parsers/
|   |   |-- pdf.ts
|   |   |-- pptx.ts
|   |   |-- markdown.ts
|   |   |-- text.ts
|   |   |-- web.ts
|   |   `-- youtube.ts
|   |-- evaluation/
|   |   |-- rubric.ts
|   |   |-- deterministic.ts
|   |   `-- llm-evaluator.ts
|   `-- policy/
|       |-- modes.ts
|       |-- source-policy.ts
|       `-- readiness.ts
|
|-- sources/
|   |-- inbox/
|   `-- courses/<course-id>/
|
|-- curricula/
|   `-- <course-id>/
|       |-- manifest.yaml
|       |-- curriculum.md
|       `-- source-map.json
|
|-- content/
|   |-- topics/
|   |-- sessions/
|   |-- activities/
|   |-- questions/
|   |-- visuals/
|   `-- exports/
|
|-- learner/
|   |-- profile.md
|   `-- preferences.yaml
|
|-- _learning/
|   |-- learning.db
|   |-- indexes/
|   |-- graphs/
|   |-- manifests/
|   `-- migrations/
|
|-- research/
|-- tests/
|   |-- unit/
|   |-- integration/
|   |-- pedagogy/
|   |-- fixtures/
|   `-- golden-sessions/
|
|-- scripts/
|-- README.md
|-- DESIGN.md
|-- package.json
`-- tsconfig.json
```

### Folder rules

- `sources/` = learner-supplied or explicitly attached source material.
- `curricula/` = inspectable curriculum artifacts generated/maintained by the engine.
- `content/` = learner-facing notes, maps, question banks, session exports, and visuals.
- `_learning/` = machine-managed internal state. The learner may inspect it but should not manually edit it in normal use.
- `.pi/` = runtime integration only; domain logic belongs under `src/` when possible.

---

# 9. Course model

A **Course** is the top-level learning workspace.

Examples:

- `logic-year2`
- `advanced-algorithms`
- `python-from-zero`
- `calculus-1`

Required fields:

```yaml
id: logic-year2
title: Propositional Logic
mode: source_grounded            # source_grounded | generated_curriculum | hybrid
subject_type: formal_reasoning   # optional specialization
objective: Understand and pass the module assessments
source_policy:
  primary: learner_material
  allow_external_clarification: true
  preserve_course_notation: true
assessment_target:
  type: university_module
  format: mixed
retention_horizon: end_of_academic_year
default_learning_mode: teach
```

Generated course example:

```yaml
id: python-from-zero
title: Python Programming
mode: generated_curriculum
subject_type: programming
objective: Build small-to-medium projects independently and solve interview-style problems
source_policy:
  primary: authoritative_external
  preferred_domains:
    - docs.python.org
  preserve_course_notation: false
assessment_target:
  type: capability
  format: code_and_explanation
retention_horizon: long_term
default_learning_mode: teach
```

A course must never infer completion simply because every source file has been read. Completion is defined by target learning outcomes and evidence gates.

---

# 10. Content and source system

## 10.1 The user-facing content folder

The learner must be able to do something simple:

```text
sources/inbox/topic0.pdf
sources/inbox/topic1.pdf
sources/inbox/topic2.pdf
```

or:

```text
sources/courses/logic-year2/topic0.pdf
sources/courses/logic-year2/topic1.pdf
sources/courses/logic-year2/module-guide.pdf
```

Then run a command such as:

```text
/course ingest logic-year2
```

The engine should discover new/changed files by hash, extract them, and attach them to the correct course.

## 10.2 Supported source types

**V1 required:**

- PDF
- PowerPoint/PPTX
- Markdown
- plain text
- web URL / HTML page
- YouTube URL when captions/transcript are available

**Later:**

- DOCX
- scanned PDFs with OCR fallback
- images/handwritten notes
- audio/podcasts via transcription
- LMS import
- Git repositories as learning sources

## 10.3 Hybrid extraction for academic material

For PDFs/slides, text extraction alone is insufficient for:

- equations;
- diagrams;
- truth tables;
- graphs;
- visual annotations;
- spatial relationships.

The parser should use a hybrid pipeline:

1. Extract native text and structural metadata.
2. Render pages/slides to images.
3. Use vision only where the page contains meaningful visual content or extraction appears incomplete.
4. Reconcile text and visual interpretations.
5. Store source anchors at page/slide level.

OCR is a fallback for scanned documents, not the default.

## 10.4 Web ingestion

A URL source should store:

- canonical URL;
- retrieval timestamp;
- title;
- author/site when available;
- clean main content;
- section hierarchy;
- links relevant to provenance;
- content hash;
- optional snapshot path.

The system should remove navigation/advertising boilerplate and preserve headings so later retrieval can cite meaningful sections.

## 10.5 YouTube ingestion

For a YouTube source, store:

- URL/video ID;
- title/channel;
- transcript/captions;
- timestamps;
- language;
- caption origin (manual/automatic when known);
- description and referenced links when useful.

If no transcript is available, V1 should report that limitation rather than silently inventing one. Audio transcription can be a later feature.

## 10.6 Source normalization

All parsers output a shared structure:

```ts
interface SourceDocument {
  sourceId: string;
  courseId: string;
  kind: 'pdf' | 'pptx' | 'markdown' | 'text' | 'web' | 'youtube';
  title: string;
  provenance: Provenance;
  segments: SourceSegment[];
}

interface SourceSegment {
  id: string;
  order: number;
  headingPath: string[];
  text: string;
  page?: number;
  slide?: number;
  timestampStart?: number;
  timestampEnd?: number;
  visualRefs?: string[];
}
```

## 10.7 Retrieval/indexing

V1 should use deterministic local retrieval first:

- metadata filters by course/source;
- SQLite FTS5 or equivalent full-text search;
- source anchors;
- concept-to-source links.

Embeddings are optional in V1. They can be added when semantic retrieval demonstrably improves results.

Do not make a vector database a prerequisite before basic source fidelity works.

## 10.8 Prompt-injection boundary

All ingested documents and websites are **untrusted data**.

Rules:

- Source text can inform subject matter, never agent permissions.
- Instructions embedded in source material must not override system/skill rules.
- Parsed source content should be wrapped/tagged as quoted evidence.
- Tools/actions must be decided by trusted runtime instructions, not by source text.
- Web content cannot request credential disclosure or arbitrary command execution.

---

# 11. Source-grounded mode

Use when the learner supplies course material.

## 11.1 Priority rules

For course-specific questions:

1. inspect course sources;
2. answer using the lecturer/module convention;
3. use external research only to clarify, verify, or fill a documented gap;
4. explicitly mark any extension beyond supplied course scope.

## 11.2 Preserve notation and framing

If the course uses notation such as:

```text
⟦P⟧ᵥ
```

then the tutor should teach that notation even if another source uses a different convention.

The engine may say:

> "Your slides use X; some texts use Y. For this module we will use X."

It should not casually replace the course notation.

## 11.3 Scope coverage

The source auditor should build a source map:

- which concepts appear;
- which pages/slides support them;
- which assessment objectives are explicitly covered;
- where the material assumes prerequisites without explaining them;
- where external clarification is needed.

The system must distinguish:

- **verified in course material**;
- **inferred from course structure**;
- **external enrichment**.

---

# 12. From-scratch curriculum mode

Use when the learner has no supplied material, e.g. "teach me Python".

## 12.1 Curriculum generation pipeline

```text
learner goal
   -> goal clarification
   -> prior-knowledge / cold-start decision
   -> researcher maps authoritative field sources
   -> curriculum builder drafts prerequisite DAG
   -> source auditor checks foundations and claims
   -> learner sees compact plan
   -> teaching begins
```

## 12.2 Authority policy

Generated curricula should favor:

- official documentation;
- primary sources;
- recognized textbooks or university/open-course materials;
- reputable secondary sources when they add pedagogy or examples.

For Python, the official Python documentation/tutorial should normally anchor syntax and language semantics.

## 12.3 Generated curriculum is inspectable

The engine should write:

```text
curricula/python-from-zero/manifest.yaml
curricula/python-from-zero/curriculum.md
curricula/python-from-zero/source-map.json
```

The learner should be able to inspect what was generated and why.

## 12.4 Curriculum graph, not playlist

A from-scratch Python path should encode dependencies such as:

```text
values/types
   -> expressions
   -> variables
   -> branching
   -> loops
   -> functions
       -> parameters
       -> return values
       -> scope
   -> collections
   -> modules/files
   -> exceptions
   -> object model/OOP when needed
```

The exact path should adapt to the target. A learner aiming for data analysis, interview problems, automation, or web development may share foundations but diverge later.

---

# 13. Concept graph

The graph is the **coverage contract** for structured learning.

## 13.1 Node types

At minimum:

```text
concept
fact
definition
procedure
foundation
axiom
derived-result
representation
misconception
boundary-case
transfer-target
assessment-objective
goal
```

## 13.2 Edge types

At minimum:

```text
prerequisite_of
derives_to
confusable_with
represented_by
counterexample_to
used_by
transfers_to
assessed_by
```

## 13.3 Node fields

```ts
interface KnowledgeNode {
  id: string;
  courseId: string;
  title: string;
  type: NodeType;
  summary: string;
  sourceRefs: SourceAnchor[];
  importance: number;
  assessmentWeight?: number;
  status: 'locked' | 'available' | 'active' | 'covered';
}
```

## 13.4 Graph rules

- No target may be taught while a required prerequisite is still locked unless the tutor explicitly enters a top-down preview.
- Roots must be audited: do not mistake a mid-level result for a foundation.
- The graph should remain small enough to reason about; detailed subgraphs can expand on demand.
- Confusables and misconceptions are first-class edges/nodes, not notes buried in prose.
- The graph can evolve when evidence reveals an unexpected prerequisite gap.

---

# 14. Learner profile vs learner model

These are deliberately separate.

## 14.1 Learner profile

Human-editable preferences such as:

- preferred explanation density;
- whether hints should be strict or generous;
- whether to use analogies;
- preferred notation if not course-defined;
- desired pace;
- tolerance for Socratic questioning;
- whether diagrams help;
- goals and interests.

File:

```text
learner/profile.md
```

Profile data changes **delivery**.

## 14.2 Learner model

Machine-managed performance state such as:

- evidence history;
- current estimates by dimension;
- open gaps;
- delayed verification status;
- reviews due;
- concept coverage;
- scaffolding dependence;
- calibration.

Stored in:

```text
_learning/learning.db
```

Learner model data changes **beliefs about competence and what should happen next**.

Self-report never overwrites performance evidence.

---

# 15. Multidimensional learning state

For each assessable concept/skill, track these dimensions where relevant:

1. **Memory accessibility** - can it be retrieved without cues?
2. **Structural understanding** - can the learner explain how/why it works?
3. **Discrimination** - can the learner distinguish it from nearby traps?
4. **Application** - can it be used in a standard problem?
5. **Transfer** - can the same principle be used with changed surface details or in a novel context?
6. **Representation flexibility** - can the learner move between words, symbols, graphs, code, diagrams, etc.?
7. **Procedural fluency** - for procedures, can the learner execute accurately and efficiently?
8. **Scaffold independence** - how much help is needed?
9. **Calibration** - how well does confidence match actual performance?

Not every concept needs every dimension.

Each estimate should carry:

- mean/band or categorical state;
- uncertainty;
- evidence count;
- last independent success;
- last delayed success;
- highest novelty successfully demonstrated.

---

# 16. Evidence model

Every meaningful learner attempt becomes an evidence event.

```ts
interface LearningEvidence {
  id: string;
  courseId: string;
  sessionId: string;
  conceptIds: string[];
  timestamp: string;
  taskType: TaskType;
  representation: RepresentationType;
  novelty: 'repeated' | 'isomorphic' | 'near-transfer' | 'far-transfer' | 'authentic';
  assistance: 'none' | 'minimal' | 'guided' | 'worked-solution' | 'ai-performed';
  prompt: string;
  response: string;
  correctness?: number;
  rubricScores?: Record<string, number>;
  latencyMs?: number;
  learnerConfidence?: number;
  evaluator: 'deterministic' | 'llm' | 'human';
  sourceRefs?: SourceAnchor[];
  notes?: string;
}
```

## 16.1 Task types

At minimum:

```text
recognition
cued_recall
free_recall
self_explanation
discrimination
prediction
procedure
representation_conversion
analogy
error_diagnosis
near_transfer
far_transfer
simulation
authentic_performance
```

## 16.2 Assistance is part of the evidence

A correct answer after a decisive hint is useful learning evidence but weak independence evidence.

The engine must never record it as equivalent to an independent correct answer.

## 16.3 Deterministic evaluation first

When an answer can be checked deterministically, prefer that:

- exact numeric result;
- truth table;
- code test suite;
- syntax parse;
- multiple-choice option;
- set equality;
- structured expression.

Use LLM rubric evaluation for:

- causal explanations;
- teach-backs;
- proofs with flexible wording;
- design tradeoffs;
- open-ended transfer.

Store the rubric and evaluator rationale when the LLM affects state.

---

# 17. Gap escrow

A **gap** is a persistent representation of a meaningful failure.

Examples:

- misconception about implication;
- forgetting the difference between list and set behavior;
- selecting a loop when a direct membership test is appropriate;
- algebraic sign error pattern;
- inability to transfer a definition to a new representation.

Gap lifecycle:

```text
OPEN
  -> REPAIR_IN_PROGRESS
  -> AWAITING_VERIFICATION
  -> VERIFIED_CLOSED
```

Rules:

- Immediate success on the same problem cannot close the gap.
- A repair must be tested with a changed/parallel case.
- Strong gaps should be verified after separation; important ones should receive delayed review.
- Repeated failures can widen the gap from a single item to a misconception pattern.
- Closed gaps remain in history so future recurrence can be detected.

---

# 18. Session contract and modes

A structured session records:

```ts
interface LearningSession {
  id: string;
  courseId: string;
  mode: LearningMode;
  objective: string;
  minutesAvailable?: number;
  deadline?: string;
  retentionHorizon?: string;
  deliverable?: string;
  allowedTools?: string[];
  startedAt: string;
}
```

## 18.1 `teach` - deep mastery

Use when the learner says "teach me" / "I want to understand" without severe time pressure.

Requires:

- complete prerequisite path for target;
- active retrieval;
- discrimination;
- changed-context application;
- teach-back for central concepts;
- delayed verification before durable mastery.

## 18.2 `fast-learn` - bounded understanding

Use for a focused evening or short slice.

Requires:

- explain;
- retrieve;
- discriminate;
- one changed application for central concepts.

Coverage is labeled **provisional**.

## 18.3 `cram` - deadline preparation

Use only with a real imminent deadline.

Capture:

- exact exam/task;
- remaining time;
- likely mark/value weighting;
- permitted aids;
- response format;
- protected sleep/performance buffer.

Prioritize expected assessment value and largest bottlenecks. Do not claim durable mastery.

## 18.4 `exam-drill`

Use old papers, question banks, rubrics, and representative generated variants.

Workflow:

```text
bounded simulation
 -> delayed feedback until round end
 -> error diagnosis
 -> targeted repair
 -> parallel retest
 -> next round
```

## 18.5 `project`

Learner builds a real artifact while acquiring skill.

Rules:

- define a small observable milestone;
- learner writes/builds bounded parts;
- AI may scaffold, explain, review, and test;
- AI-written output is not evidence of learner ability;
- ask learner to explain design choices;
- require a changed or recreated component later.

## 18.6 `review`

Review-only session drawn from due tasks, open gaps, and high-value weak concepts.

Use mixed/interleaved tasks rather than reviewing one chapter monotonically when the learner is ready for strategy selection.

---

# 19. Diagnostic probing

## 19.1 When to probe aggressively

Use adaptive probing when:

- learner claims some prior knowledge;
- prior state exists but may be stale;
- starting mid-course;
- prerequisite competence is uncertain;
- planning an exam path.

For each relevant strand:

1. find a floor (something reliably correct);
2. find a ceiling (something failed/unknown);
3. narrow the frontier;
4. characterize failures as slips, isolated gaps, or misconceptions.

All-correct means the probe was too easy; escalate.

## 19.2 Cold-start rule

If learner genuinely starts from zero:

- do not repeatedly ask impossible questions;
- check only minimal prerequisites/general reasoning needed;
- establish 2-3 foundation nodes through worked examples;
- then begin normal retrieval and adaptive probing.

This reconciles Alvar's frontier mapping with novice cognitive load.

## 19.3 Probe must be goal-relevant

Do not map every corner of a subject. Map the prerequisite strands the target actually depends on.

---

# 20. Planning phase

Before sustained teaching:

1. confirm objective and mode;
2. inspect user sources if source-grounded;
3. run researcher if foundational facts or curriculum scope need verification;
4. build the smallest useful dependency graph;
5. mark known/unknown/untested nodes from evidence;
6. identify confusables and common misconceptions;
7. choose initial teaching sequence;
8. show the learner a compact plan and graph;
9. allow correction before proceeding.

The plan should answer:

- Where are we starting?
- What is the target?
- Why this order?
- What prerequisites matter?
- How will we know each step landed?

Do not dump the entire detailed internal graph into chat; show the map, not every implementation node.

---

# 21. Teaching microcycle

The engine's default concept loop is:

```text
ORIENT / MOTIVATE
    -> PREDICT (if learner has enough schema)
    -> EXPLAIN or DERIVE
    -> CONNECT TO PRIOR NODES
    -> RETRIEVE
    -> DISCRIMINATE
    -> APPLY / TRANSFER
    -> FEEDBACK + REPAIR IF NEEDED
    -> TEACH-BACK FOR CORE CONCEPTS
    -> RECORD EVIDENCE
    -> CHOOSE NEXT NODE
```

## 21.1 Orient / motivate

Before introducing a concept, make clear what problem it solves or why it is needed now.

## 21.2 Predict

When the learner has enough prior structure, ask them to predict before showing the result.

Do not force meaningless guesses from a complete novice.

## 21.3 Explain / derive

Prefer motivated derivation from established ideas.

For genuine definitions/foundations, state them clearly.

For derived knowledge, answer:

> "How could I have discovered this from what I already know?"

Use analogies where useful, and name where the analogy breaks.

## 21.4 Connect

Make dependency edges explicit. New facts should have somewhere to attach.

## 21.5 Retrieve

After 1-2 core ideas, require output from memory.

Possible forms:

- short answer;
- free recall/blurt;
- predict output;
- define in own words;
- reconstruct steps;
- write code from a requirement;
- draw/rebuild a structure.

## 21.6 Discriminate

Ask "why this and not the closest plausible alternative?"

This is especially important for:

- implication vs equivalence;
- list vs set;
- `for x in items` vs `for i in range(...)`;
- probability rules;
- algorithm choice;
- similar formulas.

## 21.7 Apply / transfer

Change surface details so success cannot come from memorizing a template.

Use far transfer only when useful; near transfer is sufficient for many early concepts.

## 21.8 Feedback / repair

Do not simply say "wrong" and reveal the answer.

Classify the error:

- memory failure;
- misconception;
- prerequisite gap;
- method-selection error;
- execution slip;
- representation failure.

Then repair the first broken reasoning step.

## 21.9 Teach-back

For central concepts, use a student/novice subagent that:

- asks "why" questions;
- carries realistic misconceptions;
- spots unexplained jumps;
- challenges jargon;
- ends only when the causal model holds together locally.

The subagent's approval is not durable mastery. It is one evidence event.

---

# 22. Scaffolding policy

Default progression for new procedures:

1. **Worked example** - fully solved; learner explains a decisive step.
2. **Completion problem** - setup supplied; learner completes key parts.
3. **Independent problem** - changed details; learner selects method and executes.

Fade one support dimension at a time.

If independent performance fails, restore only the support needed for that failure.

Track assistance level in the evidence record so later independence can be distinguished from guided success.

---

# 23. Question-first learning and question bank

The system should treat questions as first-class learning objects.

For source-grounded courses, ingestion/curriculum processing can generate a bank containing:

- direct recall prompts;
- causal "why/how" prompts;
- confusable contrasts;
- worked example completions;
- transfer variants;
- exam-style questions;
- learner-created questions;
- questions generated from the learner's own mistakes.

Each question should link to:

- concepts tested;
- source anchors;
- expected answer/rubric;
- difficulty;
- novelty family;
- assessment format;
- prior attempts.

The engine should encourage:

```text
attempt from memory
 -> evaluate
 -> inspect original source for the miss
 -> explain the gap
 -> attempt a changed version later
```

Question banks can be exported to Markdown and, later, Anki/RemNote formats, but the engine remains the canonical evidence store.

---

# 24. Quiz design

## 24.1 Default to generation, not recognition

Short-answer/open retrieval is preferred when feasible.

Use MCQ when:

- diagnosing a specific confusable misconception;
- matching an actual exam format;
- rapidly mapping a frontier.

## 24.2 Good MCQ construction

- Every option is a bare claim with parallel structure.
- Correct and incorrect options should be similar in length/style.
- Distractors should represent real misconceptions, not jokes.
- No formatting should reveal the answer.
- Explanations appear only after answering.

## 24.3 Avoid answer leakage

Do not put the exact answer immediately before a retrieval prompt unless it is explicitly a worked-example phase.

After an explanation, insert enough learner production that later testing is not merely echoing the previous sentence.

---

# 25. Spacing and review scheduler

## 25.1 Two timescales

The system uses both:

- **within-session retrieval** after a short learning chunk;
- **between-session delayed retrieval** for durability.

## 25.2 Not every review is a flashcard

Review tasks can be:

- atomic recall;
- open explanation;
- discrimination;
- changed application;
- representation conversion;
- procedure execution;
- debugging;
- timed mini-simulation;
- gap verification.

## 25.3 Scheduler models

Use a mixed scheduler:

- **FSRS-like memory scheduling** for atomic/cued/free retrieval objects;
- **conceptual scheduling** for explanation/discrimination/transfer;
- **deadline scheduling** for exams;
- **simulation scheduling** for full performance checks.

## 25.4 Priority function

Review priority should consider:

```text
due-ness
+ open gap severity
+ concept importance
+ assessment weight
+ prerequisite centrality
+ uncertainty / lack of evidence
+ predicted learning gain
+ deadline proximity
- recent over-practice
```

## 25.5 Interleaving

Once basic schema exists, mix related concepts so the learner must select the method rather than recognize a chapter cue.

Do not interleave so early that the learner cannot identify any method at all.

---

# 26. Readiness and stopping criteria

Never use a single overall score as the sole readiness gate.

## 26.1 Deep mastery

For each core assessable concept, require relevant evidence across:

- independent retrieval;
- causal explanation;
- discrimination;
- changed application;
- gap verification where applicable;
- delayed independent check (target: >=24h for durable claims).

Procedures additionally need independent execution.

## 26.2 Fast learning

Require at minimum:

- retrieval;
- explanation;
- discrimination;
- one changed application.

Label as provisional and disclose untested scope.

## 26.3 Cram / exam

Require evidence aligned to the actual assessment format and disclose every important untested skill.

## 26.4 Project

Require:

- independent explanation of key mechanisms/tradeoffs;
- artifact contribution by the learner;
- changed-case application;
- later partial recreation when meaningful.

---

# 27. Subject-specific assessment adapters

The pedagogical core stays general, but assessment should specialize by domain.

## 27.1 Logic / mathematics

Evidence types:

- definitions in own words;
- symbol/English translation;
- truth tables;
- derivations/proofs;
- counterexamples;
- boundary cases;
- unseen problems;
- representation conversion (formula <-> graph/table/words).

The system should parse notation from course material and preserve it.

## 27.2 Programming

Evidence types:

- predict code output;
- explain a snippet;
- write a small function;
- debug broken code;
- modify existing code under a new requirement;
- choose between alternative data structures/algorithms;
- solve an unseen problem;
- explain tradeoffs;
- recreate a previously scaffolded component later.

A passing test suite proves the code passes those tests; it does not by itself prove the learner understands why.

## 27.3 Algorithms/data structures

Evidence types:

- identify invariant;
- trace algorithm;
- complexity reasoning;
- choose structure for a scenario;
- compare confusable algorithms;
- implement from specification;
- adapt to changed constraints.

## 27.4 Probability/statistics

Evidence types:

- interpret quantities verbally;
- select appropriate rule/model;
- calculate;
- distinguish conditional/joint/marginal ideas;
- diagnose misleading intuitions;
- apply to unfamiliar scenario.

---

# 28. Programming-from-zero example

A generated Python course might begin:

```text
FOUNDATIONS
  values + types
      -> expressions
      -> variables
      -> basic I/O

CONTROL FLOW
  booleans/comparisons
      -> if/elif/else
      -> loops

ABSTRACTION
  functions
      -> parameters
      -> return values
      -> scope

DATA
  strings
  lists
  tuples
  sets
  dictionaries
      -> iteration patterns
      -> membership
      -> transformations

PROGRAM STRUCTURE
  modules
  files
  exceptions
  testing/debugging

LATER, WHEN JUSTIFIED BY GOAL
  classes/OOP
  packages/environments
  APIs
  data processing
  algorithms
  project architecture
```

The engine should not teach OOP merely because it is "next in a textbook". It should appear when the target and dependency graph justify it.

For a beginner, early tasks should be small and independent. Project mode can begin once enough primitives exist to build a meaningful V1.

---

# 29. Visual system

Use visuals only when they carry structure that prose does poorly.

## 29.1 Mermaid maker

For:

- prerequisite DAGs;
- pipelines;
- state machines;
- sequences;
- trees/hierarchies;
- comparisons;
- system architecture.

## 29.2 SVG maker

For:

- coordinate geometry;
- vectors;
- number lines;
- exact spatial layouts;
- plots/custom geometric diagrams.

## 29.3 Verification loop

Every generated visual must:

1. receive a minimal concrete brief;
2. render to a stable image;
3. be visually inspected by the maker;
4. be revised if labels/arrows/layout are wrong;
5. only then be published.

The learner should see the exact artifact that was verified.

---

# 30. Specialist agents

## 30.1 Researcher

Responsibilities:

- verify factual foundations;
- prefer official/primary sources;
- map a field for curriculum generation;
- identify standard framing and common gotchas;
- report uncertainty and source disagreement.

The researcher should return a compact sourced brief, not teach the learner directly.

## 30.2 Curriculum builder

Responsibilities:

- turn a learner goal and research brief into a prerequisite DAG;
- select scope appropriate to goal/time;
- attach sources/provenance;
- propose assessment objectives;
- avoid unnecessary textbook-style breadth.

## 30.3 Source auditor

Responsibilities:

- map course sources to concepts;
- detect source conflicts;
- identify missing prerequisites;
- distinguish course-required material from external enrichment;
- check generated curriculum roots.

## 30.4 Student / Feynman peer

Responsibilities:

- hold realistic seeded misconceptions;
- ask one high-value "why" question per turn;
- identify jargon and logical leaps;
- update local mental model when correctly taught;
- never pretend its approval proves durable mastery.

## 30.5 Visual makers

Responsibilities as described in Section 29.

---

# 31. Learner-facing commands / interactions

Exact syntax can change, but V1 should support these intents.

```text
/course new
/course list
/course use <id>
/course ingest [path-or-url]
/course sources
/course map

/learn <topic>
/review
/status
/gaps
/questions

/mode teach
/mode fast-learn
/mode cram
/mode exam-drill
/mode project

/export notes
/export questions
```

Natural language should work too:

> "Add these three PDFs to Logic."

> "Teach me Topic 1 for 45 minutes."

> "I have an exam on Friday. Drill the weak stuff from Topics 0-3."

Commands are convenience, not mandatory ceremony.

---

# 32. User-facing artifacts

The system should produce inspectable artifacts instead of hiding everything in chat history.

## 32.1 Topic notes

`content/topics/<course>/<topic>.md`

Contains:

- compact concept map;
- foundations;
- derived connections;
- important examples;
- unresolved gaps;
- source citations.

## 32.2 Session record

`content/sessions/<date>-<course>-<slug>.md`

Contains:

- objective/mode;
- concepts covered;
- questions attempted;
- corrections;
- open gaps;
- next review targets.

## 32.3 Question bank

`content/questions/<course>.md` or export generated from DB.

Questions remain linked to source anchors and concept IDs.

## 32.4 Visuals

`content/visuals/`

Use unique names and embed into Markdown/Obsidian-compatible logs.

---

# 33. Persistence architecture

## 33.1 SQLite as canonical machine state

Use one versioned SQLite database for:

- courses;
- sources/segments metadata;
- concepts and graph edges;
- evidence;
- gaps;
- review tasks;
- sessions;
- attempts;
- question metadata;
- source hashes.

Human-readable Markdown/YAML files are exports/configuration, not the sole canonical transactional store.

## 33.2 Suggested tables

```text
courses
sources
source_segments
concepts
concept_edges
concept_sources
questions
sessions
attempts
learning_evidence
learner_dimension_state
gaps
review_tasks
curriculum_versions
migrations
```

## 33.3 Migrations

Every schema change must be versioned.

- Never silently discard learner history.
- Back up DB before destructive migrations.
- Provide a migration test fixture from each supported prior version.

---

# 34. Data provenance

A `Provenance` record should identify:

```ts
interface Provenance {
  origin: 'learner_file' | 'learner_url' | 'authoritative_web' | 'secondary_web' | 'generated';
  uri?: string;
  localPath?: string;
  title?: string;
  author?: string;
  retrievedAt?: string;
  contentHash?: string;
  parentSourceIds?: string[];
}
```

Generated curriculum claims should point to parent sources.

Generated practice questions should point to the concepts/source segments they were derived from.

---

# 35. Evaluation and rubric design

## 35.1 Open explanations

Do not exact-string grade a Feynman explanation.

Evaluation rubric can include:

- core causal relation present;
- no contradiction;
- prerequisite connection explicit;
- correct boundary/condition;
- jargon correctly unpacked;
- no critical omission.

## 35.2 LLM evaluator constraints

An evaluator must receive:

- question/task;
- expected concepts/rubric;
- course source anchors;
- learner answer;
- assistance context.

It must not receive hidden future answers that would leak into the learner interaction.

## 35.3 Confidence and calibration

When useful, ask learner confidence after an answer.

Calibration evidence compares confidence to correctness over time.

Do not interrupt every micro-task for confidence ratings; sample strategically.

---

# 36. Feedback policy

Good feedback should be:

- immediate enough to prevent reinforcing an error;
- specific to the first broken reasoning step;
- minimal enough that the learner still has work to do;
- connected to the governing principle;
- followed by a changed test.

Hint ladder for problem solving:

1. identify where to look;
2. remind relevant concept;
3. ask a leading structural question;
4. provide partial setup;
5. worked repair only when necessary.

Track the highest hint level used.

---

# 37. Source conflict and hallucination policy

When sources disagree:

1. identify the conflict;
2. rank source authority and recency;
3. distinguish factual disagreement from convention;
4. tell the learner when uncertainty matters;
5. do not silently choose the convenient answer.

For a course with supplied material, the engine can say:

> "For your module, use the lecturer's convention X. External references often use Y."

For a factual error in supplied material, do not knowingly teach falsehood as truth. Flag it carefully and support the correction with authoritative evidence.

---

# 38. Academic-integrity / assessment behavior

The product is a learning engine, so its default project/exam behavior should preserve learner agency.

For genuine study:

- allow hints, explanations, examples, and practice variants;
- encourage the learner to attempt first;
- clearly distinguish worked examples from independent evidence;
- do not record AI-produced work as learner competence.

For practice exams/simulations:

- feedback can be withheld until submission;
- use realistic time limits when requested;
- separate simulation score from teaching attempts.

---

# 39. Security and privacy

## 39.1 Local-first learning data

By default, learner state, source indexes, and logs should live in the project directory/local machine.

## 39.2 Secrets

Provider credentials belong in the runtime's protected credential store, never in:

- course manifests;
- source metadata;
- session logs;
- exported Markdown;
- Git commits.

## 39.3 Path boundaries

Extensions should restrict writing to intended project paths unless a tool explicitly requires otherwise.

## 39.4 Third-party extensions

Pi extensions have broad local permissions. Pin dependencies, review code, and avoid installing arbitrary packages into the learning runtime.

---

# 40. Observability

The engine should have a developer-facing diagnostic view showing:

- active course/session/mode;
- current graph node;
- why the next node was selected;
- retrieved source anchors;
- evidence event written;
- gap lifecycle transitions;
- review task scheduling decision;
- evaluator used;
- model/provider used;
- tool failures.

This should be available without polluting normal learner-facing chat.

---

# 41. Testing strategy

A learning engine needs more than unit tests.

## 41.1 Unit tests

Test deterministic components:

- source hashing;
- parser normalization;
- graph locking/unlocking;
- readiness gates;
- gap state transitions;
- review priority;
- scheduler math;
- migrations;
- deterministic grading.

## 41.2 Integration tests

Examples:

- ingest a PDF -> concepts reference correct page anchors;
- ingest a website -> source search returns the correct section;
- create course -> configure session -> record attempt -> update evidence -> schedule review;
- open gap -> repair -> same-session success does not close -> later parallel success closes;
- restart Pi -> state persists.

## 41.3 Golden teaching sessions

Create fixtures for known learner behaviors:

- true novice;
- learner who gets every easy probe correct;
- confident misconception;
- careless slip;
- assisted success;
- correct recall but failed transfer;
- strong understanding but weak memory;
- source conflict.

Compare system actions against expected policy decisions.

## 41.4 Pedagogy invariants

Automated checks should detect violations such as:

- claiming mastery from one MCQ;
- closing a gap on the same repaired item;
- repeatedly cold-testing a novice;
- using user self-report as mastery evidence;
- using external notation instead of course notation without explanation;
- teaching from a source that was never inspected in source-grounded mode;
- generating project code and counting it as learner performance.

## 41.5 Adversarial source tests

Ingest files/web pages containing prompt-injection text and verify that the engine treats it as data rather than instructions.

---

# 42. Performance and reliability

V1 should optimize for correctness and inspectability over maximum automation.

Guidelines:

- cache parsed source content by hash;
- do not re-run expensive visual extraction unnecessarily;
- keep source retrieval local where possible;
- batch background-free deterministic preprocessing during explicit ingest;
- keep conversational latency low by preparing course indexes ahead of teaching;
- gracefully degrade if a subagent/visual tool is unavailable.

The core tutor should still work without visual makers or OpenClaw.

---

# 43. Model/provider abstraction

Do not hardcode pedagogy to one model.

Define model roles/configuration:

```text
teacher_model
researcher_model
evaluator_model
visual_model (if needed)
```

A single model may fill all roles initially.

Provider/model selection should be runtime configuration, not persisted inside learning evidence except as audit metadata.

---

# 44. V1 user experience

## 44.1 Source-grounded first run

```text
1. User creates/chooses course.
2. User drops logic slides in sources/courses/logic-year2/.
3. User adds module website URL.
4. /course ingest
5. Engine reports sources found, extraction status, and any failures.
6. User: "Teach me Topic 1."
7. Engine inspects source coverage and asks only necessary goal/time questions.
8. Engine probes prerequisite frontier unless user is a cold start.
9. Engine presents compact dependency map.
10. User approves.
11. Teaching microcycle begins.
12. Evidence/gaps/review tasks are persisted.
13. Session ends with what is solid, provisional, untested, and due next.
```

## 44.2 From-scratch first run

```text
1. User: "Teach me Python from zero."
2. Engine confirms target (general coding / projects / interviews) and time horizon.
3. Cold-start route selected.
4. Researcher finds authoritative curriculum sources.
5. Curriculum builder creates inspectable DAG + source map.
6. Engine presents compact plan.
7. Foundations taught through worked example -> retrieval.
8. Question bank grows from concepts and mistakes.
9. Learner progresses toward increasingly independent coding tasks.
10. Delayed reviews and project milestones are scheduled.
```

---

# 45. End-of-session contract

Every structured session should end with a concise status containing:

- **Established today:** what has evidence.
- **Provisional:** what succeeded only same-session / with support.
- **Open gaps:** what remains unresolved.
- **Untested:** important scope that was not assessed.
- **Next step:** next concept or activity.
- **Reviews due:** delayed checks created.

Do not end with vague praise such as "you've mastered this" unless the mode-specific evidence gate is actually met.

---

# 46. Implementation interfaces

## 46.1 Persistence boundary

Domain services call repositories; Pi extensions should not write ad-hoc JSON everywhere.

Example:

```ts
interface EvidenceRepository {
  add(event: LearningEvidence): Promise<void>;
  listForConcept(courseId: string, conceptId: string): Promise<LearningEvidence[]>;
}
```

## 46.2 Ingestion adapter boundary

```ts
interface SourceParser {
  supports(input: SourceInput): boolean;
  parse(input: SourceInput): Promise<SourceDocument>;
}
```

## 46.3 Evaluator boundary

```ts
interface AnswerEvaluator {
  canEvaluate(task: AssessmentTask): boolean;
  evaluate(task: AssessmentTask, response: string): Promise<EvaluationResult>;
}
```

## 46.4 Scheduler boundary

```ts
interface ReviewScheduler {
  schedule(input: ReviewSchedulingInput): Promise<ReviewTask>;
  getDue(courseId: string, now: Date): Promise<ReviewTask[]>;
}
```

These boundaries make it possible to replace Pi, the database driver, or the scheduling algorithm without rewriting pedagogy.

---

# 47. V1 build order

## Phase 0 - repository skeleton and quality gates

Deliverables:

- TypeScript project;
- Pi package/project loading;
- test runner;
- lint/typecheck;
- SQLite migration framework;
- basic path/security helpers.

Acceptance:

- clean install;
- `check` and tests run;
- Pi loads a no-op learning extension.

## Phase 1 - course + source ingestion

Deliverables:

- course manager;
- source inbox;
- PDF/PPTX/Markdown/Text/URL ingestion;
- source metadata + anchors;
- local full-text search;
- course manifest.

Acceptance:

- ingest the user's logic slides and website;
- retrieve the correct page/slide/section for a question;
- no teaching logic yet.

## Phase 2 - curriculum + concept graph

Deliverables:

- concept/node schema;
- prerequisite/confusable edges;
- graph persistence;
- source-grounded graph builder;
- generated-curriculum flow using researcher + curriculum builder;
- map export/visualization.

Acceptance:

- build a usable Logic topic graph from supplied material;
- build a Python-from-zero graph with authoritative provenance.

## Phase 3 - session + probe + plan

Deliverables:

- session modes/contracts;
- learner profile loader;
- cold-start detector;
- adaptive probe;
- plan presentation.

Acceptance:

- existing learner gets a frontier map;
- true novice is not spammed with impossible questions;
- plan is shown before sustained teaching.

## Phase 4 - teaching tools

Deliverables:

- quiz short-answer + MCQ;
- open explanation;
- blurt/free recall;
- activity tool;
- scaffolding support;
- teaching skill.

Acceptance:

- one concept can run through explain -> retrieve -> discriminate -> apply.

## Phase 5 - evidence + mastery + gaps

Deliverables:

- evidence event store;
- dimension updater;
- gap engine;
- gap escrow;
- mastery/readiness report.

Acceptance:

- assisted success is distinguishable from independent success;
- immediate repair cannot close its own gap;
- readiness report lists missing evidence.

## Phase 6 - review scheduler

Deliverables:

- delayed review tasks;
- FSRS-like atomic review scheduling;
- conceptual/deadline tasks;
- `/review` queue;
- interleaving policy.

Acceptance:

- a learned concept creates a future task;
- failed delayed review reopens/updates state;
- cram deadline can reprioritize queue.

## Phase 7 - specialist agents + visuals

Deliverables:

- researcher;
- student/Feynman peer;
- Mermaid maker;
- SVG maker;
- render-inspect loop.

Acceptance:

- concept plan can render a verified DAG;
- teach-back exchange writes evidence;
- failed visual rendering does not break teaching.

## Phase 8 - learner-facing exports / polish

Deliverables:

- Markdown/Obsidian log;
- topic notes;
- question bank export;
- source citation formatting;
- status/gaps commands.

## Phase 9 - optional OpenClaw / external UI

Only after the core engine is stable.

Potential features:

- messaging channels;
- review reminders;
- remote session resume;
- web dashboard;
- mobile-friendly review.

---

# 48. V1 acceptance scenarios

The build is not "V1 complete" until these scenarios work end-to-end.

## Scenario A - Logic slides

- Add Topic 0-2 slides/PDFs.
- Add module website.
- Ask to learn Topic 1.
- Engine retrieves course notation and exact source scope.
- Engine probes Topic 0 prerequisites.
- Engine identifies a misconception if one appears.
- Engine teaches one node at a time.
- Engine uses short-answer/open reasoning, not only MCQs.
- Engine produces a changed application.
- Session creates delayed review.
- Reopening later resumes from durable state, not chat memory.

## Scenario B - Python from zero

- No source files.
- User says "teach me Python from zero".
- Engine builds an authoritative sourced curriculum.
- Cold-start path begins with worked examples rather than impossible quizzes.
- Learner writes code, predicts output, debugs, and explains.
- Hints are tracked as assistance.
- Project mode eventually lets learner build a project without the AI doing it for them.
- A later recreation task verifies independence.

## Scenario C - Exam tomorrow

- Learner supplies syllabus/past paper.
- Sets deadline and available minutes.
- Engine prioritizes weighted weak concepts.
- Runs timed representative practice.
- Diagnoses errors and retests changed forms.
- Protects sleep/performance buffer.
- Ends by disclosing untested scope rather than claiming full readiness.

## Scenario D - Simple question

- Learner asks one narrow conceptual question.
- Engine answers directly.
- No unnecessary session setup or mastery ceremony.

---

# 49. Metrics for whether the product is actually working

Avoid optimizing only for engagement or session length.

Useful measures:

- delayed retrieval success;
- gap recurrence rate;
- transfer success after standard success;
- assistance needed over time;
- calibration error;
- percentage of planned core concepts with required evidence;
- review completion and lapse rate;
- source citation accuracy;
- course-scope fidelity;
- learner time spent producing answers vs passively reading AI output.

A strong system should gradually increase learner independence.

---

# 50. Product decisions that are already made

1. **Pi first.**
2. **Do not fork Pi initially.**
3. **Codex builds the repository.**
4. **OpenClaw is optional later, not core.**
5. **Two content modes:** source-grounded and generated-from-scratch, plus hybrid.
6. **Dedicated user source folder.**
7. **Preserve course notation/scope.**
8. **Generated curricula require verified source provenance.**
9. **Learner preferences are not mastery evidence.**
10. **Persistent evidence model, not chat-memory-only.**
11. **Multidimensional learning state.**
12. **Gap escrow.**
13. **Active recall throughout first learning and revision.**
14. **Spacing and delayed verification.**
15. **Question banks are first-class.**
16. **Scaffolding must fade.**
17. **Project work must be learner-produced to count as competence.**
18. **Visuals use render-and-inspect verification.**
19. **Small questions stay small.**
20. **The engine should be host-portable in its domain logic.**

---

# 51. Decisions intentionally deferred

These should not block V1:

- final product name;
- web/mobile UI framework;
- cloud sync;
- multi-user/classroom support;
- embedding/vector database choice;
- Anki bidirectional sync;
- voice tutoring;
- automatic audio transcription;
- calendar integration;
- OpenClaw deployment topology;
- gamification;
- social/sharing features.

---

# 52. Codex implementation rules

When handing this project to Codex:

## 52.1 Never ask for the whole system in one prompt

Use bounded phases from Section 47.

## 52.2 Every feature needs tests before moving on

A phase is not complete because files exist. It is complete when its acceptance scenario passes.

## 52.3 Do not let Codex invent domain semantics silently

If a design decision would change:

- mastery rules;
- evidence weighting;
- gap closure;
- source priority;
- course scope;
- scheduler semantics;
- data schema in a breaking way;

then update this design/ADR first.

## 52.4 Preserve separation of concerns

- Pi extension = adapter/UI/tool registration.
- Domain service = learning behavior.
- Repository = persistence.
- Parser = content normalization.
- Evaluator = answer assessment.
- Skill prompt = model behavior/pedagogy.

Do not put the entire product inside one giant `SKILL.md` or one 3,000-line extension.

## 52.5 Prefer deterministic code over prompts when possible

Examples:

- graph locking;
- database transitions;
- source hashing;
- due-date math;
- exact-answer grading;
- migration logic;
- path permissions.

Use models where interpretation/reasoning is genuinely required.

---

# 53. Suggested first Codex task

The first implementation task should be only:

> Create the repository skeleton, TypeScript domain model, SQLite persistence/migrations, Course model, Source model, and a minimal Pi extension exposing `/course new`, `/course list`, and `/course use`. Add unit tests and a `check` script. Do not implement teaching, curriculum generation, mastery, or review yet.

Why first:

- establishes architectural boundaries;
- proves Pi integration;
- creates a stable storage foundation;
- prevents later pedagogy code from becoming file-based spaghetti.

The second task should implement source ingestion and local retrieval, and should be validated against the learner's real Logic slides before teaching features are added.

---

# 54. Research/evidence notes

The source systems and videos repeatedly rely on principles that are well represented in mainstream learning research. The implementation should continue to verify the exact operational claims before hard-coding thresholds.

Principles worth treating as stable design foundations:

- retrieval practice/testing effect;
- distributed/spaced practice;
- generation effect;
- worked examples and scaffolding for novices;
- self-explanation / teaching as generative learning;
- interleaving for discrimination/strategy selection;
- feedback and error correction;
- transfer through surface variation;
- desirable difficulty, applied carefully rather than maximized blindly.

Important caution:

The engine should not pretend that one paper gives a universal numerical rule for every learner. Research informs the mechanism; learner evidence tunes the implementation.

---

# 55. Source references

## Primary project sources

1. Eero Alvar, **How I Use AI to Learn Things**  
   https://www.youtube.com/watch?v=kzcI5F4tGiU

2. Amos Blomqvist, **learn - My AI learning system**  
   https://github.com/amosblomqvist/learn

3. Amos Blomqvist, **teach skill**  
   https://github.com/amosblomqvist/learn/blob/main/skills/teach/SKILL.md

4. Amos Blomqvist, **visualize skill**  
   https://github.com/amosblomqvist/learn/blob/main/skills/visualize/SKILL.md

5. Kruthvik, **Sato - learning engine built on pi-agent**  
   https://github.com/kruthvik/sato

6. Sato, **teach skill**  
   https://github.com/kruthvik/sato/blob/main/.pi/skills/teach/SKILL.md

7. Sato, **BKT/evidence engine**  
   https://github.com/kruthvik/sato/blob/main/.pi/extensions/bkt-engine.ts

8. Sato, **learning session extension**  
   https://github.com/kruthvik/sato/blob/main/.pi/extensions/learning-session.ts

9. Sato, **FSRS/review scheduler**  
   https://github.com/kruthvik/sato/blob/main/.pi/extensions/fsrs-scheduler.ts

10. Sato, **open explanation extension**  
    https://github.com/kruthvik/sato/blob/main/.pi/extensions/explain.ts

11. Sato, **student/Feynman agent**  
    https://github.com/kruthvik/sato/blob/main/.pi/agents/student.md

## Study-method videos

12. Ali Abdaal, **How to study for exams - Evidence-based revision tips**  
    https://www.youtube.com/watch?v=ukLnPbIffxE

13. Ali Abdaal, **How to Study for Exams - Spaced Repetition**  
    https://www.youtube.com/watch?v=Z-zNHHpXoMM

14. Ali Abdaal, **Study Tips - How to learn new content**  
    https://www.youtube.com/watch?v=fBXnxlLR0PY

15. Ali Abdaal, **How my friend ranked 1st at Medical School - The Active Recall Framework**  
    https://www.youtube.com/watch?v=fDbxPVn02VU

## Runtime references

16. Pi coding-agent documentation / extension architecture  
    https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent

17. OpenClaw agent runtime architecture  
    https://github.com/openclaw/openclaw/blob/main/docs/agent-runtime-architecture.md

18. OpenClaw ACPX / Pi native session integration  
    https://github.com/openclaw/openclaw/blob/main/docs/plugins/reference/acpx.md

---

# 56. Final architectural statement

The project should be built as a **persistent evidence-driven personal learning operating system** with Pi as its first host.

Its defining loop is not simply "ask AI questions". It is:

```text
SOURCE OR GOAL
    -> MAP THE KNOWLEDGE
    -> LOCATE THE LEARNER
    -> PLAN THE SHORTEST VALID PATH
    -> TEACH ONE CONNECTED STEP
    -> REQUIRE ACTIVE PRODUCTION
    -> TEST DISCRIMINATION AND TRANSFER
    -> RECORD EVIDENCE
    -> REPAIR GAPS WITHOUT FALSE CLOSURE
    -> SPACE AND REVERIFY
    -> INCREASE INDEPENDENCE
```

The system succeeds when the learner becomes able to reconstruct, use, distinguish, and transfer knowledge **without the system's help**.

That is the north-star requirement against which every feature should be judged.
