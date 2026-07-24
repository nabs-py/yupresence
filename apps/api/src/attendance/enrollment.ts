import { prisma } from "../prisma/client.js";

interface SectionEnrollmentInput {
  courseId: number;
  section: string;
  studentId: number;
}

export async function isStudentEnrolledInSection({ courseId, section, studentId }: SectionEnrollmentInput): Promise<boolean> {
  const enrollment = await prisma.courseStudent.findFirst({
    where: { courseId, section, studentId },
    select: { id: true }
  });

  return enrollment !== null;
}
