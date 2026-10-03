import type { Migration } from './migrations.ts';
import { assistanceLevels, taskTypes, representations, noveltyTypes, origins, dimensions } from '../domain/assessment.ts';
const values = (items: readonly string[]) => items.map((v) => `'${v}'`).join(',');
const idCheck = (prefix: string) => `CHECK(id GLOB '${prefix}-????????-????-4???-[89ab]???-????????????' AND substr(id,${prefix.length + 2}) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,${prefix.length + 2}),'-',''))=32)`;
const tables = ['assessment_tasks', 'task_concepts', 'task_source_provenance', 'task_research_provenance', 'assessment_attempts', 'assessment_evaluations', 'evaluation_rubric_scores', 'evidence_events'];
export const assessmentMigration: Migration = { version: 5, name: 'assessment-and-evidence-foundation', sql: `
CREATE TABLE assessment_tasks (
  id TEXT PRIMARY KEY NOT NULL ${idCheck('task')}, course_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (${values(taskTypes)})), representation TEXT NOT NULL CHECK(representation IN (${values(representations)})),
  novelty TEXT NOT NULL CHECK(novelty IN (${values(noveltyTypes)})), origin TEXT NOT NULL CHECK(origin IN (${values(origins)})),
  prompt TEXT NOT NULL CHECK(length(trim(prompt))>0 AND length(prompt)<=16000),
  dimensions_json TEXT NOT NULL CHECK(json_valid(dimensions_json) AND json_type(dimensions_json)='array' AND json_array_length(dimensions_json) BETWEEN 1 AND 9),
  scoring_json TEXT NOT NULL CHECK(json_valid(scoring_json) AND length(scoring_json)<=50000), created_at TEXT NOT NULL,
  UNIQUE(course_id,id,curriculum_version), UNIQUE(course_id,id),
  FOREIGN KEY(course_id,curriculum_version) REFERENCES curriculum_versions(course_id,version)
) STRICT;
CREATE TRIGGER task_dimensions_valid BEFORE INSERT ON assessment_tasks
WHEN EXISTS (SELECT 1 FROM json_each(NEW.dimensions_json) WHERE value NOT IN (${values(dimensions)}))
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.dimensions_json))<>json_array_length(NEW.dimensions_json)
BEGIN SELECT RAISE(ABORT,'Invalid intended dimensions'); END;
CREATE TABLE task_concepts (
  task_id TEXT NOT NULL, course_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL, concept_id TEXT NOT NULL,
  PRIMARY KEY(task_id,concept_id), FOREIGN KEY(course_id,task_id,curriculum_version) REFERENCES assessment_tasks(course_id,id,curriculum_version) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(course_id,curriculum_version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id)
) STRICT;
CREATE TABLE task_source_provenance (
  task_id TEXT NOT NULL, course_id TEXT NOT NULL, source_id TEXT NOT NULL, source_version INTEGER NOT NULL, segment_id TEXT NOT NULL,
  PRIMARY KEY(task_id,segment_id), FOREIGN KEY(course_id,task_id) REFERENCES assessment_tasks(course_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(source_id,course_id) REFERENCES sources(id,course_id),
  FOREIGN KEY(segment_id,source_id,source_version) REFERENCES source_segments(id,source_id,version)
) STRICT;
CREATE TABLE task_research_provenance (
  task_id TEXT NOT NULL, course_id TEXT NOT NULL, brief_id TEXT NOT NULL, reference_id TEXT NOT NULL,
  PRIMARY KEY(task_id,reference_id), FOREIGN KEY(course_id,task_id) REFERENCES assessment_tasks(course_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(course_id,brief_id,reference_id) REFERENCES research_references(course_id,brief_id,id)
) STRICT;
CREATE TABLE assessment_attempts (
  id TEXT PRIMARY KEY NOT NULL ${idCheck('attempt')}, course_id TEXT NOT NULL, task_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK(length(response)<=32000),
  assistance TEXT NOT NULL CHECK(assistance IN (${values(assistanceLevels)})),
  hint_count INTEGER NOT NULL CHECK(hint_count BETWEEN 0 AND 100), highest_hint_level TEXT NOT NULL CHECK(highest_hint_level IN (${values(assistanceLevels)})),
  hint_notes TEXT CHECK(hint_notes IS NULL OR length(hint_notes)<=2000),
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1), latency_ms REAL CHECK(latency_ms IS NULL OR latency_ms BETWEEN 0 AND 86400000),
  runtime_ref TEXT CHECK(runtime_ref IS NULL OR length(runtime_ref)<=200), submitted_at TEXT NOT NULL,
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 120), request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK((hint_count=0 AND highest_hint_level='none') OR (hint_count>0 AND highest_hint_level<>'none' AND assistance<>'none')),
  UNIQUE(course_id,operation_id), UNIQUE(course_id,id),
  FOREIGN KEY(course_id,task_id) REFERENCES assessment_tasks(course_id,id)
) STRICT;
CREATE TABLE assessment_evaluations (
  id TEXT PRIMARY KEY NOT NULL ${idCheck('evaluation')}, course_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scored','unscored','failed')),
  correctness REAL CHECK(correctness IS NULL OR correctness BETWEEN 0 AND 1),
  evaluator_json TEXT NOT NULL CHECK(json_valid(evaluator_json) AND length(evaluator_json)<=1000),
  rationale TEXT NOT NULL CHECK(length(trim(rationale))>0 AND length(rationale)<=4000), created_at TEXT NOT NULL,
  supersedes TEXT CHECK(supersedes IS NULL OR supersedes<>id),
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 120), request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK((status='scored' AND correctness IS NOT NULL) OR (status<>'scored' AND correctness IS NULL)),
  UNIQUE(course_id,operation_id), UNIQUE(course_id,attempt_id,id),
  FOREIGN KEY(course_id,attempt_id) REFERENCES assessment_attempts(course_id,id),
  FOREIGN KEY(course_id,attempt_id,supersedes) REFERENCES assessment_evaluations(course_id,attempt_id,id)
) STRICT;
CREATE TABLE evaluation_rubric_scores (
  evaluation_id TEXT NOT NULL REFERENCES assessment_evaluations(id) DEFERRABLE INITIALLY DEFERRED, key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 60 AND key NOT IN ('__proto__','prototype','constructor')),
  score REAL NOT NULL CHECK(score BETWEEN 0 AND 1), PRIMARY KEY(evaluation_id,key)
) STRICT;
CREATE TABLE evidence_events (
  id TEXT PRIMARY KEY NOT NULL ${idCheck('evidence')}, course_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  FOREIGN KEY(course_id,attempt_id,evaluation_id) REFERENCES assessment_evaluations(course_id,attempt_id,id)
) STRICT;
CREATE TRIGGER evidence_not_failed BEFORE INSERT ON evidence_events
WHEN (SELECT status FROM assessment_evaluations WHERE id=NEW.evaluation_id)='failed'
BEGIN SELECT RAISE(ABORT,'Failed invocation cannot create evidence'); END;
CREATE INDEX attempts_by_course ON assessment_attempts(course_id,submitted_at,id);
CREATE INDEX evaluations_by_attempt ON assessment_evaluations(course_id,attempt_id,created_at,id);
CREATE INDEX evidence_by_course ON evidence_events(course_id,created_at,id);
CREATE INDEX tasks_by_concept ON task_concepts(course_id,concept_id,task_id);
CREATE TRIGGER task_requires_concepts BEFORE INSERT ON assessment_tasks
WHEN NOT EXISTS (SELECT 1 FROM task_concepts WHERE task_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Task requires concept targets'); END;
${['task_concepts', 'task_source_provenance', 'task_research_provenance'].map((table) => `CREATE TRIGGER ${table}_sealed BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM assessment_tasks WHERE id=NEW.task_id)
BEGIN SELECT RAISE(ABORT,'Task snapshot is sealed'); END;`).join('\n')}
CREATE TRIGGER rubric_sealed BEFORE INSERT ON evaluation_rubric_scores
WHEN EXISTS (SELECT 1 FROM assessment_evaluations WHERE id=NEW.evaluation_id)
BEGIN SELECT RAISE(ABORT,'Evaluation snapshot is sealed'); END;
CREATE TRIGGER non_scored_no_rubric BEFORE INSERT ON assessment_evaluations
WHEN NEW.status<>'scored' AND EXISTS (SELECT 1 FROM evaluation_rubric_scores WHERE evaluation_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Non-scored evaluation cannot have rubric scores'); END;
${tables.map((table) => ['UPDATE', 'DELETE'].map((action) => `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Assessment history is append-only'); END;`).join('\n')).join('\n')}
` };
