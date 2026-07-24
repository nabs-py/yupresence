-- CreateTable
CREATE TABLE "course_sections" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER NOT NULL,
    "section" VARCHAR NOT NULL,

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_course_id_section_key" ON "course_sections"("course_id", "section");

-- Preserve every section already represented by legacy enrollment,
-- teaching-assignment, or attendance-session records.
INSERT INTO "course_sections" ("course_id", "section")
SELECT DISTINCT "course_id", "section" FROM "course_students" WHERE "course_id" IS NOT NULL
UNION
SELECT DISTINCT "course_id", "section" FROM "course_professors" WHERE "course_id" IS NOT NULL
UNION
SELECT DISTINCT "course_id", "section" FROM "attendance_sessions" WHERE "course_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
