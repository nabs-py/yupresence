CREATE TABLE "device_change_requests" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(6),
    "granted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_change_requests_student_id_status_idx" ON "device_change_requests"("student_id", "status");
CREATE INDEX "device_change_requests_student_id_granted_at_idx" ON "device_change_requests"("student_id", "granted_at");
CREATE UNIQUE INDEX "device_change_requests_one_pending_per_student" ON "device_change_requests"("student_id") WHERE "status" = 'pending';

ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
