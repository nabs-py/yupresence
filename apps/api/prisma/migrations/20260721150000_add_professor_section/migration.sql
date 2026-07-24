-- Existing teaching links predate section-level assignments. Preserve them visibly.
ALTER TABLE "course_professors"
ADD COLUMN "section" VARCHAR NOT NULL DEFAULT 'legacy';

DROP INDEX "course_professors_course_id_professor_id_key";

CREATE UNIQUE INDEX "course_professors_course_id_professor_id_section_key"
ON "course_professors"("course_id", "professor_id", "section");

-- New writes must always specify the section explicitly.
ALTER TABLE "course_professors" ALTER COLUMN "section" DROP DEFAULT;
