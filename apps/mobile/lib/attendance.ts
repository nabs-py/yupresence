export function attendanceTierLabel(status: "excellent" | "safe" | "warning" | "critical"): string {
  if (status === "critical") return "Critical / DN";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
