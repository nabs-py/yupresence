-- CreateTable
CREATE TABLE "appeals" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "attachment_path" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "resolved_by_role" VARCHAR,
    "resolved_by_user_id" INTEGER,
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "professorId" INTEGER,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appeals_status_created_at_idx" ON "appeals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appeals_session_id_student_id_key" ON "appeals"("session_id", "student_id");

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_professorId_fkey" FOREIGN KEY ("professorId") REFERENCES "professors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
