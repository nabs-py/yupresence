-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "previous_qr_token" VARCHAR,
ADD COLUMN     "previous_qr_token_rotated_at" TIMESTAMP(6);
