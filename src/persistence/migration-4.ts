import type { Migration } from './migrations.ts';
export const curriculumMigration: Migration = {
    version: 4, name: 'curriculum-graphs-and-official-research', sql: `
  CREATE TABLE concepts (
    id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'concept-????????-????-4???-[89ab]???-????????????'
      AND substr(id,9) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,9),'-',''))=32),
    course_id TEXT NOT NULL REFERENCES courses(id), created_at TEXT NOT NULL, UNIQUE(course_id,id)
  ) STRICT;
  CREATE TABLE curriculum_versions (
    course_id TEXT NOT NULL REFERENCES courses(id), version INTEGER NOT NULL CHECK(version>0),
    created_at TEXT NOT NULL, activated_at TEXT, rationale TEXT NOT NULL,
    uncertainty_json TEXT NOT NULL CHECK(json_valid(uncertainty_json)), PRIMARY KEY(course_id,version)
  ) STRICT;
  CREATE TABLE curriculum_nodes (
    course_id TEXT NOT NULL, version INTEGER NOT NULL, concept_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title))>0),
    type TEXT NOT NULL CHECK(type IN ('concept','definition','procedure','representation','misconception','boundary_case','assessment_objective')),
    summary TEXT NOT NULL, PRIMARY KEY(course_id,version,concept_id),
    FOREIGN KEY(course_id,version) REFERENCES curriculum_versions(course_id,version),
    FOREIGN KEY(course_id,concept_id) REFERENCES concepts(course_id,id)
  ) STRICT;
  CREATE TABLE curriculum_edges (
    course_id TEXT NOT NULL, version INTEGER NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL CHECK(from_id<>to_id),
    type TEXT NOT NULL CHECK(type IN ('prerequisite_of','confusable_with','related_to','represented_by','counterexample_to','contrasts_with','used_by','transfers_to','assessed_by')),
    rationale TEXT NOT NULL, PRIMARY KEY(course_id,version,from_id,type,to_id),
    FOREIGN KEY(course_id,version,from_id) REFERENCES curriculum_nodes(course_id,version,concept_id),
    FOREIGN KEY(course_id,version,to_id) REFERENCES curriculum_nodes(course_id,version,concept_id)
  ) STRICT;
  CREATE TABLE course_curriculum_current (
    course_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL,
    FOREIGN KEY(course_id,version) REFERENCES curriculum_versions(course_id,version)
  ) STRICT;
  CREATE UNIQUE INDEX sources_course_identity ON sources(id,course_id);
  CREATE UNIQUE INDEX source_segment_exact_identity ON source_segments(id,source_id,version);
  CREATE TABLE node_source_provenance (
    course_id TEXT NOT NULL, version INTEGER NOT NULL, concept_id TEXT NOT NULL,
    source_id TEXT NOT NULL, source_version INTEGER NOT NULL, segment_id TEXT NOT NULL,
    PRIMARY KEY(course_id,version,concept_id,segment_id),
    FOREIGN KEY(course_id,version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id),
    FOREIGN KEY(source_id,course_id) REFERENCES sources(id,course_id),
    FOREIGN KEY(segment_id,source_id,source_version) REFERENCES source_segments(id,source_id,version)
  ) STRICT;
  CREATE TABLE research_briefs (
    id TEXT PRIMARY KEY NOT NULL CHECK(id GLOB 'brief-????????-????-4???-[89ab]???-????????????'
      AND substr(id,7) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,7),'-',''))=32),
    course_id TEXT NOT NULL REFERENCES courses(id), goal TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(course_id,id)
  ) STRICT;
  CREATE TABLE research_references (
    id TEXT PRIMARY KEY NOT NULL CHECK(id GLOB 'reference-????????-????-4???-[89ab]???-????????????'
      AND substr(id,11) NOT GLOB '*[^0-9a-f-]*' AND length(replace(substr(id,11),'-',''))=32),
    brief_id TEXT NOT NULL, course_id TEXT NOT NULL, url TEXT NOT NULL,
    title TEXT, publisher TEXT NOT NULL CHECK(publisher='Python Software Foundation'), retrieved_at TEXT NOT NULL,
    content_hash TEXT CHECK(content_hash IS NULL OR (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
    authority TEXT NOT NULL CHECK(authority='official_documentation'), status TEXT NOT NULL CHECK(status IN ('ready','failed')),
    text TEXT NOT NULL, topics_json TEXT NOT NULL CHECK(json_valid(topics_json)), notes_json TEXT NOT NULL CHECK(json_valid(notes_json)),
    CHECK((status='ready' AND content_hash IS NOT NULL AND length(trim(text))>0) OR (status='failed' AND content_hash IS NULL AND text='')),
    FOREIGN KEY(course_id,brief_id) REFERENCES research_briefs(course_id,id), UNIQUE(course_id,brief_id,id)
  ) STRICT;
  CREATE TABLE node_research_provenance (
    course_id TEXT NOT NULL, version INTEGER NOT NULL, concept_id TEXT NOT NULL, brief_id TEXT NOT NULL, reference_id TEXT NOT NULL,
    PRIMARY KEY(course_id,version,concept_id,reference_id),
    FOREIGN KEY(course_id,version,concept_id) REFERENCES curriculum_nodes(course_id,version,concept_id),
    FOREIGN KEY(course_id,brief_id,reference_id) REFERENCES research_references(course_id,brief_id,id)
  ) STRICT;`,
};
