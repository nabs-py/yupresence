/*
  Warnings:

  - You are about to drop the column `professorId` on the `appeals` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "appeals" DROP CONSTRAINT "appeals_professorId_fkey";

-- AlterTable
ALTER TABLE "appeals" DROP COLUMN "professorId";
