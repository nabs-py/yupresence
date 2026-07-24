ALTER TABLE "attendance"
ADD COLUMN "manual_override" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "scan_attempts" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER,
    "student_id" INTEGER NOT NULL,
    "result" VARCHAR NOT NULL,
    "reason_code" VARCHAR,
    "reason_message" VARCHAR,
    "device_id" VARCHAR,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distance_meters" DOUBLE PRECISION,
    "review_status" VARCHAR NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(6),
    "reviewed_by_professor_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_attempts_pkey" PRIMARY KEY ("id")
);

INSERT INTO "scan_attempts" (
    "session_id",
    "student_id",
    "result",
    "reason_code",
    "reason_message",
    "review_status",
    "created_at"
)
SELECT
    "session_id",
    "student_id",
    'failed',
    'LEGACY_FLAGGED',
    'Flagged before scan-attempt auditing was introduced.',
    'pending',
    COALESCE("timestamp", CURRENT_TIMESTAMP)
FROM "attendance"
WHERE "status" = 'flagged' AND "student_id" IS NOT NULL;

DELETE FROM "attendance" WHERE "status" <> 'present';

ALTER TABLE "attendance"
ADD CONSTRAINT "attendance_status_present_check" CHECK ("status" = 'present');

CREATE INDEX "scan_attempts_session_id_result_review_status_idx"
ON "scan_attempts"("session_id", "result", "review_status");

ALTER TABLE "scan_attempts"
ADD CONSTRAINT "scan_attempts_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "scan_attempts"
ADD CONSTRAINT "scan_attempts_student_id_fkey"
FOREIGN KEY ("student_id") REFERENCES "students"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "scan_attempts"
ADD CONSTRAINT "scan_attempts_reviewed_by_professor_id_fkey"
FOREIGN KEY ("reviewed_by_professor_id") REFERENCES "professors"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
