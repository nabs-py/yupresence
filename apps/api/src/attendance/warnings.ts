export type AttendanceWarningStatus = "excellent" | "safe" | "warning" | "critical";

export function calculateAttendanceWarning(totalSessions: number, presentSessions: number) {
  const absenceCount = Math.max(totalSessions - presentSessions, 0);
  const attendancePercentage = totalSessions === 0 ? 0 : Math.round((presentSessions / totalSessions) * 100);
  const status: AttendanceWarningStatus =
    absenceCount >= 8 ? "critical" :
    absenceCount >= 6 ? "warning" :
    absenceCount >= 4 ? "safe" :
    "excellent";

  return { absenceCount, attendancePercentage, status };
}
