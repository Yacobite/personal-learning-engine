import type { Migration } from './migrations.ts';
export const reviewMigration: Migration = { version: 9, name: 'review-and-evidence-spacing', sql: `
CREATE TABLE review_task_origins(
 task_id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL,origin TEXT NOT NULL CHECK(origin='review_generated'),
 FOREIGN KEY(course_id,task_id) REFERENCES assessment_tasks(course_id,id)
) STRICT;
CREATE TABLE review_items(
 id TEXT PRIMARY KEY NOT NULL CHECK(id GLOB 'review-????????-????-4???-[89ab]???-????????????' AND length(id)=43 AND substr(id,8) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,8),'-',''))=32),
 course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,concept_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('delayed_verification','gap_verification','maintenance')),
 dimension TEXT NOT NULL CHECK(dimension IN ('memory_accessibility','structural_understanding','discrimination','application','transfer','representation_flexibility','procedural_fluency','scaffold_independence')),
 type TEXT NOT NULL CHECK(type IN ('cued_recall','error_diagnosis','discrimination','prediction','near_transfer','representation_conversion','procedure')),
 representation TEXT NOT NULL CHECK(representation IN ('text','symbolic','numeric','code','table','graph','diagram','mixed')),
 novelty TEXT NOT NULL CHECK(novelty IN ('isomorphic','near_transfer','far_transfer','authentic')),
 assistance TEXT NOT NULL CHECK(assistance='none'),earliest_at TEXT NOT NULL,due_at TEXT NOT NULL CHECK(due_at>=earliest_at),
 stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 4),state_revision_id TEXT NOT NULL,gap_id TEXT,
 policies_json TEXT NOT NULL CHECK(json_valid(policies_json)),basis TEXT NOT NULL CHECK(length(basis)=64 AND basis NOT GLOB '*[^0-9a-f]*'),episode TEXT NOT NULL,created_at TEXT NOT NULL,
 CHECK(dimension!='transfer' OR novelty IN ('near_transfer','far_transfer','authentic')),
 CHECK((kind='gap_verification')=(gap_id IS NOT NULL)),
 UNIQUE(course_id,id),UNIQUE(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,curriculum_version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id),
 FOREIGN KEY(course_id,state_revision_id,curriculum_version) REFERENCES learner_revisions(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,gap_id,concept_id,dimension) REFERENCES learner_gap_identities(course_id,id,concept_id,dimension)
) STRICT;
CREATE TRIGGER review_origin_existing_performance BEFORE INSERT ON review_task_origins WHEN EXISTS(SELECT 1 FROM assessment_attempts WHERE task_id=NEW.task_id)
 BEGIN SELECT RAISE(ABORT,'cannot reinterpret existing performance origin');END;
CREATE TABLE review_progress(
 item_id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL,curriculum_version INTEGER NOT NULL,basis TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('scheduled','active','awaiting_evaluation','completed','superseded','cancelled')),
 task_id TEXT UNIQUE,attempt_id TEXT UNIQUE,completed_at TEXT,
 CHECK((status IN ('active','awaiting_evaluation','completed')) <= (task_id IS NOT NULL)),
 CHECK((status='awaiting_evaluation' OR status='completed') <= (attempt_id IS NOT NULL)),
 CHECK((status='completed')=(completed_at IS NOT NULL)),
 UNIQUE(course_id,item_id,attempt_id),
 FOREIGN KEY(course_id,item_id,curriculum_version) REFERENCES review_items(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,task_id,curriculum_version) REFERENCES assessment_tasks(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,task_id,attempt_id) REFERENCES assessment_attempts(course_id,task_id,id)
) STRICT;
CREATE UNIQUE INDEX review_one_active ON review_progress(course_id) WHERE status IN ('active','awaiting_evaluation');
CREATE UNIQUE INDEX review_one_pending_basis ON review_progress(course_id,basis) WHERE status IN ('scheduled','active','awaiting_evaluation');
CREATE TABLE review_events(
 ordinal INTEGER PRIMARY KEY,course_id TEXT NOT NULL,item_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('scheduled','active','awaiting_evaluation','completed','superseded','cancelled','task_linked','outcome_linked')),
 at TEXT NOT NULL,reason TEXT NOT NULL,evaluation_id TEXT,evidence_id TEXT,
 FOREIGN KEY(course_id,item_id) REFERENCES review_items(course_id,id),
 FOREIGN KEY(evaluation_id) REFERENCES assessment_evaluations(id),FOREIGN KEY(evidence_id) REFERENCES evidence_events(id)
) STRICT;
CREATE TABLE review_outcomes(
 course_id TEXT NOT NULL,item_id TEXT NOT NULL,attempt_id TEXT NOT NULL,evaluation_id TEXT NOT NULL,evidence_id TEXT,
 PRIMARY KEY(item_id,evaluation_id),
 FOREIGN KEY(course_id,item_id,attempt_id) REFERENCES review_progress(course_id,item_id,attempt_id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id) REFERENCES assessment_evaluations(course_id,attempt_id,id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id,evidence_id) REFERENCES evidence_events(course_id,attempt_id,evaluation_id,id)
) STRICT;
CREATE TABLE review_reconciliations(
 ordinal INTEGER PRIMARY KEY,course_id TEXT NOT NULL,state_revision_id TEXT NOT NULL,at TEXT NOT NULL,fingerprint TEXT NOT NULL,
 UNIQUE(course_id,fingerprint),FOREIGN KEY(course_id,state_revision_id) REFERENCES learner_revisions(course_id,id)
) STRICT;
CREATE TRIGGER review_event_scope BEFORE INSERT ON review_events WHEN
 (NEW.evaluation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assessment_evaluations e JOIN review_progress p ON p.attempt_id=e.attempt_id WHERE p.item_id=NEW.item_id AND p.course_id=NEW.course_id AND e.course_id=NEW.course_id AND e.id=NEW.evaluation_id))
 OR (NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM evidence_events e WHERE e.id=NEW.evidence_id AND e.evaluation_id=NEW.evaluation_id AND e.course_id=NEW.course_id))
 BEGIN SELECT RAISE(ABORT,'review event outcome scope mismatch');END;
CREATE TRIGGER review_progress_insert BEFORE INSERT ON review_progress WHEN NEW.status!='scheduled' OR NEW.task_id IS NOT NULL OR NEW.attempt_id IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM review_items i WHERE i.id=NEW.item_id AND i.basis=NEW.basis AND i.course_id=NEW.course_id AND i.curriculum_version=NEW.curriculum_version)
 BEGIN SELECT RAISE(ABORT,'invalid initial review progress');END;
CREATE TRIGGER review_progress_identity BEFORE UPDATE ON review_progress WHEN
 NEW.item_id!=OLD.item_id OR NEW.course_id!=OLD.course_id OR NEW.curriculum_version!=OLD.curriculum_version OR NEW.basis!=OLD.basis
 OR (OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id) OR (OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id)
 OR OLD.status IN ('completed','superseded','cancelled')
 OR NOT ((OLD.status='scheduled' AND NEW.status IN ('active','superseded','cancelled')) OR (OLD.status='active' AND NEW.status IN ('awaiting_evaluation','superseded','cancelled')) OR (OLD.status='awaiting_evaluation' AND NEW.status IN ('awaiting_evaluation','completed')))
 BEGIN SELECT RAISE(ABORT,'invalid review transition');END;
CREATE TRIGGER review_task_scope BEFORE UPDATE ON review_progress WHEN NEW.task_id IS NOT NULL AND (
 (SELECT count(*) FROM task_concepts WHERE task_id=NEW.task_id)!=1 OR NOT EXISTS(SELECT 1 FROM review_items i JOIN task_concepts t ON t.concept_id=i.concept_id WHERE i.id=NEW.item_id AND t.task_id=NEW.task_id)
 OR NOT EXISTS(SELECT 1 FROM review_task_origins WHERE task_id=NEW.task_id AND origin='review_generated'))
 BEGIN SELECT RAISE(ABORT,'review task scope mismatch');END;
CREATE TRIGGER review_completion BEFORE UPDATE ON review_progress WHEN NEW.status='completed' AND NOT EXISTS(
 SELECT 1 FROM review_outcomes o JOIN assessment_evaluations e ON e.id=o.evaluation_id WHERE o.item_id=NEW.item_id AND e.status!='failed')
 BEGIN SELECT RAISE(ABORT,'review completion requires M4 evaluation');END;
CREATE TRIGGER review_outcome_failed BEFORE INSERT ON review_outcomes WHEN ((SELECT status FROM assessment_evaluations WHERE id=NEW.evaluation_id)='failed')!=(NEW.evidence_id IS NULL)
 BEGIN SELECT RAISE(ABORT,'invalid review outcome link');END;
${['review_items', 'review_task_origins', 'review_events', 'review_outcomes', 'review_reconciliations'].flatMap(t => ['UPDATE', 'DELETE'].map(op => `CREATE TRIGGER ${t}_no_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'review history immutable');END;`)).join('\n')}
CREATE TRIGGER review_progress_no_delete BEFORE DELETE ON review_progress BEGIN SELECT RAISE(ABORT,'review progress retained');END;
` };
