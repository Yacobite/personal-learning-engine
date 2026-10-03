import type { Migration } from './migrations.ts';
const idCheck = (prefix: string) => `CHECK(id GLOB '${prefix}-????????-????-4???-[89ab]???-????????????' AND length(id)=${prefix.length + 37} AND substr(id,${prefix.length + 2}) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,${prefix.length + 2}),'-',''))=32)`;
export const teachingMigration: Migration = { version: 7, name: 'bounded-teaching', sql: `
CREATE TABLE teaching_sessions (
 id TEXT PRIMARY KEY NOT NULL ${idCheck('teaching')}, course_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL,
 policy TEXT NOT NULL CHECK(policy='bounded-instruction-v1'), diagnostic_id TEXT,
 recommendations_json TEXT NOT NULL CHECK(json_valid(recommendations_json)), budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 80),
 status TEXT NOT NULL CHECK(status IN ('in_progress','completed','abandoned')), started_at TEXT NOT NULL, ended_at TEXT,
 summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)), state_json TEXT NOT NULL CHECK(json_valid(state_json)), revision INTEGER NOT NULL CHECK(revision>=0),
 CHECK((status='in_progress' AND ended_at IS NULL AND summary_json IS NULL) OR (status!='in_progress' AND ended_at IS NOT NULL AND summary_json IS NOT NULL)),
 UNIQUE(course_id,id,curriculum_version), UNIQUE(course_id,id),
 FOREIGN KEY(course_id,curriculum_version) REFERENCES curriculum_versions(course_id,version),
 FOREIGN KEY(course_id,diagnostic_id,curriculum_version) REFERENCES diagnostic_sessions(course_id,id,curriculum_version)
) STRICT;
CREATE TRIGGER teaching_diagnostic_start BEFORE INSERT ON teaching_sessions WHEN NEW.diagnostic_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM diagnostic_sessions WHERE id=NEW.diagnostic_id AND status='completed') BEGIN SELECT RAISE(ABORT,'teaching requires a completed diagnostic'); END;
CREATE UNIQUE INDEX one_active_teaching ON teaching_sessions(course_id) WHERE status='in_progress';
CREATE TABLE teaching_moves (
 id TEXT PRIMARY KEY NOT NULL ${idCheck('move')}, course_id TEXT NOT NULL, session_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 80), concept_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('activate_prior_knowledge','explain','independent_practice','guided_practice','scaffold','teach_back','near_transfer')),
 reason TEXT NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 4), content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 task_id TEXT, attempt_id TEXT, status TEXT NOT NULL CHECK(status IN ('content','outstanding','answered','resolved')), created_at TEXT NOT NULL,
 CHECK((type IN ('explain','scaffold'))=(task_id IS NULL)),
 CHECK((status='content' AND task_id IS NULL AND attempt_id IS NULL) OR (status='outstanding' AND task_id IS NOT NULL AND attempt_id IS NULL) OR (status IN ('answered','resolved') AND task_id IS NOT NULL AND attempt_id IS NOT NULL)),
 UNIQUE(session_id,sequence), UNIQUE(task_id), UNIQUE(attempt_id), UNIQUE(course_id,id), UNIQUE(course_id,id,attempt_id),
 FOREIGN KEY(course_id,session_id,curriculum_version) REFERENCES teaching_sessions(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,curriculum_version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id),
 FOREIGN KEY(course_id,task_id,curriculum_version) REFERENCES assessment_tasks(course_id,id,curriculum_version),
 FOREIGN KEY(task_id,concept_id) REFERENCES task_concepts(task_id,concept_id),
 FOREIGN KEY(course_id,task_id,attempt_id) REFERENCES assessment_attempts(course_id,task_id,id)
) STRICT;
CREATE UNIQUE INDEX one_pending_teaching ON teaching_moves(session_id) WHERE status IN ('outstanding','answered');
CREATE TABLE teaching_support (
 course_id TEXT NOT NULL, task_move_id TEXT NOT NULL, hint_move_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(task_move_id,hint_move_id), FOREIGN KEY(course_id,task_move_id) REFERENCES teaching_moves(course_id,id), FOREIGN KEY(course_id,hint_move_id) REFERENCES teaching_moves(course_id,id)
) STRICT;
CREATE TABLE teaching_outcomes (
 course_id TEXT NOT NULL, move_id TEXT NOT NULL, attempt_id TEXT NOT NULL, evaluation_id TEXT NOT NULL, evidence_id TEXT,
 PRIMARY KEY(move_id,evaluation_id), FOREIGN KEY(course_id,move_id,attempt_id) REFERENCES teaching_moves(course_id,id,attempt_id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id) REFERENCES assessment_evaluations(course_id,attempt_id,id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id,evidence_id) REFERENCES evidence_events(course_id,attempt_id,evaluation_id,id)
) STRICT;
CREATE TRIGGER teaching_move_sequence BEFORE INSERT ON teaching_moves BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM teaching_sessions s WHERE s.id=NEW.session_id AND s.status='in_progress' AND NEW.sequence<=s.budget)
 OR NEW.sequence!=(SELECT count(*)+1 FROM teaching_moves WHERE session_id=NEW.session_id)
 THEN RAISE(ABORT,'invalid teaching move sequence') END;
END;
CREATE TRIGGER teaching_session_identity BEFORE UPDATE ON teaching_sessions WHEN
 OLD.status!='in_progress' OR NEW.id!=OLD.id OR NEW.course_id!=OLD.course_id OR NEW.curriculum_version!=OLD.curriculum_version OR NEW.policy!=OLD.policy OR NEW.diagnostic_id IS NOT OLD.diagnostic_id OR NEW.recommendations_json!=OLD.recommendations_json OR NEW.budget!=OLD.budget OR NEW.started_at!=OLD.started_at
 BEGIN SELECT RAISE(ABORT,'teaching session identity/final summary sealed'); END;
CREATE TRIGGER teaching_move_identity BEFORE UPDATE ON teaching_moves WHEN
 NEW.id!=OLD.id OR NEW.course_id!=OLD.course_id OR NEW.session_id!=OLD.session_id OR NEW.curriculum_version!=OLD.curriculum_version OR NEW.sequence!=OLD.sequence OR NEW.concept_id!=OLD.concept_id OR NEW.type!=OLD.type OR NEW.reason!=OLD.reason OR NEW.level!=OLD.level OR NEW.content_json!=OLD.content_json OR NEW.task_id IS NOT OLD.task_id OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.status='outstanding' AND NEW.status='answered') OR (OLD.status='answered' AND NEW.status='resolved' AND NEW.attempt_id=OLD.attempt_id))
 BEGIN SELECT RAISE(ABORT,'invalid teaching move transition'); END;
CREATE TRIGGER teaching_resolution BEFORE UPDATE ON teaching_moves WHEN NEW.status='resolved' AND NOT EXISTS(SELECT 1 FROM teaching_outcomes o JOIN assessment_evaluations e ON e.id=o.evaluation_id WHERE o.move_id=OLD.id AND e.status!='failed') BEGIN SELECT RAISE(ABORT,'teaching resolution needs M4 evaluation'); END;
CREATE TRIGGER teaching_outcome_scope BEFORE INSERT ON teaching_outcomes WHEN NOT EXISTS(SELECT 1 FROM teaching_moves m JOIN teaching_sessions s ON s.id=m.session_id WHERE m.id=NEW.move_id AND m.status='answered' AND s.status='in_progress') OR ((SELECT status FROM assessment_evaluations WHERE id=NEW.evaluation_id)='failed')!=(NEW.evidence_id IS NULL) BEGIN SELECT RAISE(ABORT,'invalid teaching outcome'); END;
CREATE TRIGGER teaching_support_scope BEFORE INSERT ON teaching_support WHEN NOT EXISTS(SELECT 1 FROM teaching_moves t JOIN teaching_moves h ON h.session_id=t.session_id WHERE t.id=NEW.task_move_id AND h.id=NEW.hint_move_id AND t.status='outstanding' AND h.type='scaffold' AND h.concept_id=t.concept_id) BEGIN SELECT RAISE(ABORT,'invalid teaching support'); END;
${['teaching_sessions', 'teaching_moves', 'teaching_support', 'teaching_outcomes'].map(t => `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'teaching audit immutable'); END;`).join('\n')}
${['teaching_support', 'teaching_outcomes'].map(t => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'teaching audit immutable'); END;`).join('\n')}
` };
