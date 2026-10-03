import type { Migration } from './migrations.ts';
const idCheck = (prefix: string) => `CHECK(id GLOB '${prefix}-????????-????-4???-[89ab]???-????????????' AND length(id)=${prefix.length + 37} AND substr(id,${prefix.length + 2}) NOT GLOB '*[^0-9a-f-]*')`;
export const diagnosticMigration: Migration = { version: 6, name: 'diagnostic-probing', sql: `
CREATE UNIQUE INDEX diagnostic_attempt_alignment ON assessment_attempts(course_id,task_id,id);
CREATE UNIQUE INDEX diagnostic_evidence_alignment ON evidence_events(course_id,attempt_id,evaluation_id,id);
CREATE TABLE diagnostic_sessions (
 id TEXT PRIMARY KEY NOT NULL ${idCheck('diagnostic')}, course_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL,
 policy TEXT NOT NULL CHECK(policy='prerequisite-frontier-v1'), budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 20),
 status TEXT NOT NULL CHECK(status IN ('in_progress','completed','abandoned')),
 started_at TEXT NOT NULL, ended_at TEXT, stop_reason TEXT CHECK(stop_reason IN ('budget_exhausted','coverage_sufficient','frontier_located','no_eligible_probe','learner_stopped')),
 summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
 CHECK((status='in_progress' AND ended_at IS NULL AND stop_reason IS NULL AND summary_json IS NULL) OR
       (status!='in_progress' AND ended_at IS NOT NULL AND stop_reason IS NOT NULL AND summary_json IS NOT NULL)),
 CHECK((status='abandoned')=(stop_reason='learner_stopped') OR status='in_progress'),
 UNIQUE(course_id,id,curriculum_version), UNIQUE(course_id,id),
 FOREIGN KEY(course_id,curriculum_version) REFERENCES curriculum_versions(course_id,version)
) STRICT;
CREATE UNIQUE INDEX one_active_diagnostic ON diagnostic_sessions(course_id) WHERE status='in_progress';
CREATE TABLE diagnostic_prior_attempts (
 session_id TEXT NOT NULL, course_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
 PRIMARY KEY(session_id,attempt_id), FOREIGN KEY(course_id,session_id) REFERENCES diagnostic_sessions(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(course_id,attempt_id) REFERENCES assessment_attempts(course_id,id)
) STRICT;
CREATE TABLE diagnostic_probes (
 id TEXT PRIMARY KEY NOT NULL ${idCheck('probe')}, course_id TEXT NOT NULL, session_id TEXT NOT NULL, curriculum_version INTEGER NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 20), concept_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('outstanding','answered','resolved','skipped')), selection_reason TEXT NOT NULL,
 created_at TEXT NOT NULL, answered_at TEXT, resolved_at TEXT,
 CHECK((status IN ('outstanding','skipped') AND attempt_id IS NULL AND answered_at IS NULL) OR (status IN ('answered','resolved') AND attempt_id IS NOT NULL AND answered_at IS NOT NULL)),
 CHECK((status IN ('resolved','skipped'))=(resolved_at IS NOT NULL)),
 UNIQUE(session_id,sequence), UNIQUE(session_id,concept_id), UNIQUE(task_id), UNIQUE(attempt_id), UNIQUE(course_id,id,attempt_id),
 FOREIGN KEY(course_id,session_id,curriculum_version) REFERENCES diagnostic_sessions(course_id,id,curriculum_version),
 FOREIGN KEY(course_id,task_id,curriculum_version) REFERENCES assessment_tasks(course_id,id,curriculum_version),
 FOREIGN KEY(task_id,concept_id) REFERENCES task_concepts(task_id,concept_id),
 FOREIGN KEY(course_id,task_id,attempt_id) REFERENCES assessment_attempts(course_id,task_id,id)
) STRICT;
CREATE UNIQUE INDEX one_pending_diagnostic_probe ON diagnostic_probes(session_id) WHERE status IN ('outstanding','answered');
CREATE TRIGGER diagnostic_prior_sealed BEFORE INSERT ON diagnostic_prior_attempts WHEN EXISTS(SELECT 1 FROM diagnostic_sessions WHERE id=NEW.session_id)
 BEGIN SELECT RAISE(ABORT,'diagnostic prior snapshot sealed'); END;
CREATE TRIGGER diagnostic_prior_scope AFTER INSERT ON diagnostic_sessions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM diagnostic_prior_attempts p JOIN assessment_attempts a ON a.id=p.attempt_id JOIN assessment_tasks t ON t.id=a.task_id WHERE p.session_id=NEW.id AND (p.course_id!=NEW.course_id OR t.curriculum_version!=NEW.curriculum_version))
 THEN RAISE(ABORT,'diagnostic prior snapshot scope mismatch') END;
END;
CREATE TABLE diagnostic_probe_outcomes (
 ordinal INTEGER PRIMARY KEY, course_id TEXT NOT NULL, probe_id TEXT NOT NULL, attempt_id TEXT NOT NULL, evaluation_id TEXT NOT NULL, evidence_id TEXT,
 UNIQUE(probe_id,evaluation_id),
 FOREIGN KEY(course_id,probe_id,attempt_id) REFERENCES diagnostic_probes(course_id,id,attempt_id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id) REFERENCES assessment_evaluations(course_id,attempt_id,id),
 FOREIGN KEY(course_id,attempt_id,evaluation_id,evidence_id) REFERENCES evidence_events(course_id,attempt_id,evaluation_id,id)
) STRICT;
CREATE TRIGGER diagnostic_session_identity BEFORE UPDATE ON diagnostic_sessions WHEN
 OLD.status!='in_progress' OR NEW.status='in_progress' OR NEW.id!=OLD.id OR NEW.course_id!=OLD.course_id OR NEW.curriculum_version!=OLD.curriculum_version OR NEW.policy!=OLD.policy OR NEW.budget!=OLD.budget OR NEW.started_at!=OLD.started_at
 BEGIN SELECT RAISE(ABORT,'diagnostic session identity/final summary immutable'); END;
CREATE TRIGGER diagnostic_session_completion BEFORE UPDATE ON diagnostic_sessions WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM diagnostic_probes WHERE session_id=OLD.id AND status IN ('outstanding','answered'))
 BEGIN SELECT RAISE(ABORT,'pending diagnostic probe prevents completion'); END;
CREATE TRIGGER diagnostic_probe_insert BEFORE INSERT ON diagnostic_probes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM diagnostic_sessions s WHERE s.id=NEW.session_id AND s.status='in_progress' AND NEW.sequence<=s.budget)
 OR NEW.sequence!=(SELECT count(*)+1 FROM diagnostic_probes WHERE session_id=NEW.session_id)
 OR (SELECT count(*) FROM task_concepts WHERE task_id=NEW.task_id)!=1
 THEN RAISE(ABORT,'invalid diagnostic probe insertion') END;
END;
CREATE TRIGGER diagnostic_probe_update BEFORE UPDATE ON diagnostic_probes WHEN
 NEW.id!=OLD.id OR NEW.course_id!=OLD.course_id OR NEW.session_id!=OLD.session_id OR NEW.curriculum_version!=OLD.curriculum_version OR NEW.sequence!=OLD.sequence OR NEW.concept_id!=OLD.concept_id OR NEW.task_id!=OLD.task_id OR NEW.selection_reason!=OLD.selection_reason OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.status='outstanding' AND NEW.status IN ('answered','skipped')) OR (OLD.status='answered' AND NEW.status='resolved' AND NEW.attempt_id=OLD.attempt_id AND NEW.answered_at=OLD.answered_at)) OR
 NOT EXISTS(SELECT 1 FROM diagnostic_sessions WHERE id=OLD.session_id AND status='in_progress')
 BEGIN SELECT RAISE(ABORT,'invalid diagnostic probe transition'); END;
CREATE TRIGGER diagnostic_probe_resolution BEFORE UPDATE ON diagnostic_probes WHEN NEW.status='resolved' AND NOT EXISTS(SELECT 1 FROM diagnostic_probe_outcomes o JOIN assessment_evaluations e ON e.id=o.evaluation_id WHERE o.probe_id=OLD.id AND e.status!='failed')
 BEGIN SELECT RAISE(ABORT,'diagnostic resolution requires an evaluation outcome'); END;
CREATE TRIGGER diagnostic_outcome_insert BEFORE INSERT ON diagnostic_probe_outcomes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM diagnostic_probes p JOIN diagnostic_sessions s ON s.id=p.session_id WHERE p.id=NEW.probe_id AND p.status='answered' AND s.status='in_progress')
 OR ((SELECT status FROM assessment_evaluations WHERE id=NEW.evaluation_id)='failed')!=(NEW.evidence_id IS NULL)
 THEN RAISE(ABORT,'invalid diagnostic outcome') END;
END;
${['diagnostic_sessions', 'diagnostic_probes', 'diagnostic_prior_attempts', 'diagnostic_probe_outcomes'].map(t => `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'diagnostic audit immutable'); END;`).join('\n')}
${['diagnostic_prior_attempts', 'diagnostic_probe_outcomes'].map(t => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'diagnostic audit immutable'); END;`).join('\n')}
` };
