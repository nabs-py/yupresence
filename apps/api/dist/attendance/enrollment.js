import { prisma } from "../prisma/client.js";
export async function isStudentEnrolledInSection({ courseId, section, studentId }) {
    const enrollment = await prisma.courseStudent.findFirst({
        where: { courseId, section, studentId },
        select: { id: true }
    });
    return enrollment !== null;
}
