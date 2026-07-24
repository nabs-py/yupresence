-- Existing rows predate section-level enrollment. Keep them usable and visibly marked.
ALTER TABLE "course_students"
ADD COLUMN "section" VARCHAR NOT NULL DEFAULT 'legacy';

ALTER TABLE "attendance_sessions"
ADD COLUMN "section" VARCHAR NOT NULL DEFAULT 'legacy';

-- New writes must always provide a section explicitly.
ALTER TABLE "course_students" ALTER COLUMN "section" DROP DEFAULT;
ALTER TABLE "attendance_sessions" ALTER COLUMN "section" DROP DEFAULT;
