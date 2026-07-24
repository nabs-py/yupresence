ALTER TABLE "attendance_warnings" ADD COLUMN "absence_count" INTEGER;

UPDATE "attendance_warnings" AS warning
SET
    "absence_count" = counts.absence_count,
    "attendance_percentage" = counts.attendance_percentage,
    "status" = CASE
        WHEN counts.absence_count >= 8 THEN 'critical'
        WHEN counts.absence_count >= 6 THEN 'warning'
        WHEN counts.absence_count >= 4 THEN 'safe'
        ELSE 'excellent'
    END
FROM (
    SELECT
        warning_row.id,
        COUNT(session_row.id)::INTEGER - COUNT(present_row.id)::INTEGER AS absence_count,
        CASE
            WHEN COUNT(session_row.id) = 0 THEN 0
            ELSE ROUND((COUNT(present_row.id)::DECIMAL / COUNT(session_row.id)::DECIMAL) * 100)
        END AS attendance_percentage
    FROM "attendance_warnings" AS warning_row
    LEFT JOIN "attendance_sessions" AS session_row
        ON session_row.course_id = warning_row.course_id
    LEFT JOIN "attendance" AS present_row
        ON present_row.session_id = session_row.id
        AND present_row.student_id = warning_row.student_id
        AND present_row.status = 'present'
    GROUP BY warning_row.id
) AS counts
WHERE warning.id = counts.id;

UPDATE "attendance_warnings"
SET "absence_count" = 0
WHERE "absence_count" IS NULL;

ALTER TABLE "attendance_warnings" ALTER COLUMN "absence_count" SET NOT NULL;

CREATE UNIQUE INDEX "attendance_warnings_student_id_course_id_key"
ON "attendance_warnings"("student_id", "course_id");
