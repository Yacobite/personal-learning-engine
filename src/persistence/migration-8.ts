import type { Migration } from './migrations.ts';
// Frozen schema vocabulary: future policy changes must not rewrite this migration.
const dimensions = ['memory_accessibility','structural_understanding','discrimination','application','transfer','representation_flexibility','procedural_fluency','scaffold_independence','calibration'];
const dimensionBands = ['untested','assisted_only','assisted_difficulty','independent_difficulty','mixed','provisional_support','durable_support'];
const gapStatuses = ['OPEN','REPAIR_IN_PROGRESS','AWAITING_VERIFICATION','VERIFIED_CLOSED'];
const competenceStages = ['not_ready','instructionally_ready','provisional_competence','durable_mastery','not_applicable'];
const values = (items: readonly string[]) => items.map(s => "'" + s + "'").join(',');
const idCheck = (prefix: string) => `CHECK(id GLOB '${prefix}-????????-????-4???-[89ab]???-????????????' AND length(id)=${prefix.length + 37} AND length(replace(substr(id,${prefix.length + 2}),'-',''))=32 AND substr(id,${prefix.length + 2}) NOT GLOB '*[^0-9a-f-]*')`;
export const learnerStateMigration: Migration = { version: 8, name: 'learner-state-readiness-gap-escrow', sql: `
CREATE TABLE learner_revisions(
 id TEXT PRIMARY KEY NOT NULL ${idCheck('state')},course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,
 revision_number INTEGER NOT NULL CHECK(revision_number>0),policies_json TEXT NOT NULL CHECK(json_valid(policies_json)),
 created_at TEXT NOT NULL,as_of TEXT NOT NULL,fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
 observations_json TEXT NOT NULL CHECK(json_valid(observations_json)),
 UNIQUE(course_id,curriculum_version,revision_number),UNIQUE(course_id,curriculum_version,fingerprint),UNIQUE(course_id,id,curriculum_version),UNIQUE(course_id,id),
 FOREIGN KEY(course_id,curriculum_version) REFERENCES curriculum_versions(course_id,version)
) STRICT;
CREATE TABLE learner_current(
 course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,revision_id TEXT NOT NULL,
 PRIMARY KEY(course_id,curriculum_version),
 FOREIGN KEY(course_id,revision_id,curriculum_version) REFERENCES learner_revisions(course_id,id,curriculum_version)
) STRICT;
CREATE TABLE learner_dimensions(
 revision_id TEXT NOT NULL,course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,concept_id TEXT NOT NULL,
 dimension TEXT NOT NULL CHECK(dimension IN (${values(dimensions)})),band TEXT NOT NULL CHECK(band IN (${values(dimensionBands)})),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),PRIMARY KEY(revision_id,concept_id,dimension),
 FOREIGN KEY(course_id,revision_id,curriculum_version) REFERENCES learner_revisions(course_id,id,curriculum_version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,curriculum_version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id)
) STRICT;
CREATE TABLE learner_dimension_evidence(
 revision_id TEXT NOT NULL,course_id TEXT NOT NULL,concept_id TEXT NOT NULL,dimension TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('supporting','contradictory','contextual')),attempt_id TEXT NOT NULL,evaluation_id TEXT NOT NULL,evidence_id TEXT,
 PRIMARY KEY(revision_id,concept_id,dimension,role,evaluation_id),
 FOREIGN KEY(revision_id,concept_id,dimension) REFERENCES learner_dimensions(revision_id,concept_id,dimension),
 FOREIGN KEY(course_id,revision_id) REFERENCES learner_revisions(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,attempt_id,evaluation_id) REFERENCES assessment_evaluations(course_id,attempt_id,id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id,evidence_id) REFERENCES evidence_events(course_id,attempt_id,evaluation_id,id)
) STRICT;
CREATE TABLE learner_gap_identities(
 id TEXT PRIMARY KEY NOT NULL ${idCheck('gap')},course_id TEXT NOT NULL,concept_id TEXT NOT NULL,
 dimension TEXT NOT NULL CHECK(dimension IN (${values(dimensions)})),trigger_attempt_id TEXT NOT NULL,policy TEXT NOT NULL,
 UNIQUE(course_id,concept_id,dimension,trigger_attempt_id,policy),UNIQUE(course_id,id),UNIQUE(course_id,id,concept_id,dimension),
 FOREIGN KEY(course_id,concept_id) REFERENCES concepts(course_id,id),
 FOREIGN KEY(course_id,trigger_attempt_id) REFERENCES assessment_attempts(course_id,id)
) STRICT;
CREATE TABLE learner_gap_snapshots(
 revision_id TEXT NOT NULL,course_id TEXT NOT NULL,concept_id TEXT NOT NULL,dimension TEXT NOT NULL,gap_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN (${values(gapStatuses)})),recurs_from TEXT,awaiting_attempt_id TEXT,eligible_after TEXT,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),PRIMARY KEY(revision_id,gap_id),
 CHECK(recurs_from IS NULL OR recurs_from!=gap_id),
 FOREIGN KEY(course_id,revision_id) REFERENCES learner_revisions(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,gap_id,concept_id,dimension) REFERENCES learner_gap_identities(course_id,id,concept_id,dimension),
 FOREIGN KEY(course_id,recurs_from) REFERENCES learner_gap_identities(course_id,id),
 FOREIGN KEY(course_id,awaiting_attempt_id) REFERENCES assessment_attempts(course_id,id)
) STRICT;
CREATE UNIQUE INDEX learner_one_active_gap ON learner_gap_snapshots(revision_id,concept_id,dimension) WHERE status!='VERIFIED_CLOSED';
CREATE TABLE learner_gap_evidence(
 revision_id TEXT NOT NULL,course_id TEXT NOT NULL,gap_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>0),
 status TEXT NOT NULL CHECK(status IN (${values(gapStatuses)})),attempt_id TEXT NOT NULL,evaluation_id TEXT NOT NULL,evidence_id TEXT NOT NULL,
 PRIMARY KEY(revision_id,gap_id,ordinal),
 FOREIGN KEY(revision_id,gap_id) REFERENCES learner_gap_snapshots(revision_id,gap_id),
 FOREIGN KEY(course_id,revision_id) REFERENCES learner_revisions(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,gap_id) REFERENCES learner_gap_identities(course_id,id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id,evidence_id) REFERENCES evidence_events(course_id,attempt_id,evaluation_id,id)
) STRICT;
CREATE TABLE learner_readiness(
 revision_id TEXT NOT NULL,course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,concept_id TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN (${values(competenceStages)})),snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(revision_id,concept_id),
 FOREIGN KEY(course_id,revision_id,curriculum_version) REFERENCES learner_revisions(course_id,id,curriculum_version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,curriculum_version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id)
) STRICT;
CREATE TRIGGER learner_gap_trigger_scope BEFORE INSERT ON learner_gap_identities WHEN NOT EXISTS(
 SELECT 1 FROM assessment_attempts a JOIN task_concepts c ON c.task_id=a.task_id WHERE a.course_id=NEW.course_id AND a.id=NEW.trigger_attempt_id AND c.concept_id=NEW.concept_id)
 BEGIN SELECT RAISE(ABORT,'gap trigger must target its concept');END;
CREATE TRIGGER learner_dimension_scope BEFORE INSERT ON learner_dimension_evidence WHEN NOT EXISTS(
 SELECT 1 FROM assessment_attempts a JOIN task_concepts c ON c.task_id=a.task_id WHERE a.course_id=NEW.course_id AND a.id=NEW.attempt_id AND c.concept_id=NEW.concept_id)
 BEGIN SELECT RAISE(ABORT,'dimension evidence must target its concept');END;
${['learner_revisions', 'learner_dimensions', 'learner_dimension_evidence', 'learner_gap_identities', 'learner_gap_snapshots', 'learner_gap_evidence', 'learner_readiness'].flatMap(t => ['UPDATE', 'DELETE'].map(op => `CREATE TRIGGER ${t}_no_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'learner history immutable');END;`)).join('\n')}
${['learner_dimensions', 'learner_dimension_evidence', 'learner_gap_snapshots', 'learner_gap_evidence', 'learner_readiness'].map(t => `CREATE TRIGGER ${t}_sealed BEFORE INSERT ON ${t} WHEN EXISTS(SELECT 1 FROM learner_revisions WHERE id=NEW.revision_id) BEGIN SELECT RAISE(ABORT,'learner revision sealed');END;`).join('\n')}
` };
