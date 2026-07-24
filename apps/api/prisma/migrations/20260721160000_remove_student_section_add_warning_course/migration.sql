-- Student.section was a global value and cannot represent per-course sections.
ALTER TABLE "students" DROP COLUMN "section";

-- Existing warnings have no course association, so they are derived data that
-- must be recomputed rather than incorrectly assigned to an arbitrary course.
ALTER TABLE "attendance_warnings" ADD COLUMN "course_id" INTEGER;
DELETE FROM "attendance_warnings";
ALTER TABLE "attendance_warnings" ALTER COLUMN "course_id" SET NOT NULL;
ALTER TABLE "attendance_warnings"
ADD CONSTRAINT "attendance_warnings_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
