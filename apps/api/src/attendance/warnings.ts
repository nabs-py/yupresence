export type AttendanceWarningStatus = "excellent" | "safe" | "warning" | "critical";

export const attendanceWarningThresholds = {
  safe: 4,
  warning: 7,
  critical: 10
} as const;

export function isVisibleAttendanceWarning(status: AttendanceWarningStatus) {
  return status === "warning" || status === "critical";
}

export function calculateAttendanceWarning(totalSessions: number, presentSessions: number) {
  const absenceCount = Math.max(totalSessions - presentSessions, 0);
  const attendancePercentage = totalSessions === 0 ? 0 : Math.round((presentSessions / totalSessions) * 100);
  const status: AttendanceWarningStatus =
    absenceCount >= attendanceWarningThresholds.critical ? "critical" :
    absenceCount >= attendanceWarningThresholds.warning ? "warning" :
    absenceCount >= attendanceWarningThresholds.safe ? "safe" :
    "excellent";

  return { absenceCount, attendancePercentage, status };
}
