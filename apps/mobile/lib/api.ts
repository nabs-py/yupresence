import { useAuthStore } from "../stores/auth-store";

interface ApiErrorResponse {
  code?: string;
  error?: string;
}

function apiErrorMessage(payload: ApiErrorResponse): string {
  const message = payload.error ?? "Something went wrong. Please try again.";
  return payload.code ? `${payload.code}: ${message}` : message;
}

async function readApiPayload<T>(response: Response): Promise<T & ApiErrorResponse> {
  try {
    return await response.json() as T & ApiErrorResponse;
  } catch {
    return {} as T & ApiErrorResponse;
  }
}

function clearSessionAfterUnauthorized(token: string, payload: ApiErrorResponse): void {
  const authState = useAuthStore.getState();

  // Ignore an old response that arrives after the user has already started a
  // different session. signOut clears Zustand synchronously before storage IO.
  if (authState.token === token) {
    void authState.signOut(payload.code === "DEVICE_RESET_APPROVED" ? "Your device change request was approved. Please sign in again to continue." : undefined);
  }
}

async function readAuthenticatedResponse<T>(response: Response, token: string): Promise<T> {
  const payload = await readApiPayload<T>(response);

  if (!response.ok) {
    if (response.status === 401) {
      clearSessionAfterUnauthorized(token, payload);
    }
    throw new Error(apiErrorMessage(payload));
  }

  return payload;
}

interface LoginResponse {
  token: string;
  user: {
    name: string;
    email: string;
    role: "student" | "professor" | "admin";
    device_binding_required: boolean;
  };
}

export interface StudentProfileResponse {
  name: string;
  email: string;
  role: "student";
  student_id: string;
  department: string | null;
  semester: number | null;
  device_change_request: {
    id: number;
    status: "pending" | "granted" | "rejected";
    granted_at: string | null;
    created_at: string;
  } | null;
}

export interface ProfessorProfileResponse {
  name: string;
  email: string;
  employee_id: string;
  department: string | null;
}

export interface AdminProfileResponse {
  name: string;
  email: string;
  admin_code: string;
}

export interface StudentAttendanceResponse {
  overall_percentage: number;
  attendance_streak: number;
  present_today: boolean;
  courses: Array<{
    course_id: number;
    course_code: string;
    course_name: string;
    section: string;
    present_sessions: number;
    total_sessions: number;
    attendance_percentage: number;
    absence_count: number;
    warning_status: "excellent" | "safe" | "warning" | "critical";
  }>;
  warnings: Array<{
    id: number;
    course_id: number;
    course_code: string;
    course_name: string;
    absence_count: number;
    attendance_percentage: string | number | null;
    status: "warning" | "critical";
  }>;
}

export interface ProfessorReportsResponse {
  sections: Array<{
    course_id: number;
    course_code: string;
    course_name: string;
    section: string;
    defaulters: Array<{
      name: string;
      student_id: string;
      absence_count: number;
      attendance_percentage: string | number | null;
      status: "warning" | "critical";
    }>;
  }>;
  recent_sessions: Array<{
    session_id: number;
    course_code: string;
    course_name: string;
    section: string;
    ended_at: string | null;
  }>;
  pagination: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface ProfessorAnalyticsResponse {
  sections: Array<{
    course_id: number;
    course_code: string;
    course_name: string;
    section: string;
    attendance_rate: number;
    total_sessions: number;
    enrolled_students: number;
    tiers: {
      excellent: number;
      safe: number;
      warning: number;
      critical: number;
    };
  }>;
}

export interface ProfessorAssignmentsResponse {
  assignments: Array<{
    course_id: number;
    course_code: string;
    course_name: string;
    section: string;
  }>;
}

export interface AdminStatisticsResponse {
  students: number;
  professors: number;
  courses: number;
  sections: number;
  sessions: number;
}

export interface AdminCatalogResponse {
  courses: Array<{ course_id: number; course_code: string; course_name: string; semester: number | null; sections: string[] }>;
  professors: Array<{ professor_id: number; name: string; email: string; employee_id: string; department: string | null }>;
  students: Array<{ student_id: number; university_student_id: string; name: string; email: string; department: string | null; semester: number | null }>;
}

export interface ActiveProfessorSessionResponse {
  session: {
    session_id: number;
    course_id: number;
    course_code: string;
    course_name: string;
    section: string;
    created_at: string | null;
    expires_at: string | null;
    status: "active";
    present_count: number;
    pending_count: number;
    flagged_count: number;
  } | null;
}

export interface StudentCoursesResponse {
  courses: Array<{
    course_code: string;
    course_name: string;
    section: string;
    attendance_percentage: number;
    present_count: number;
    absent_count: number;
    warning_status: "excellent" | "safe" | "warning" | "critical";
    history: Array<{
      session_id: number;
      date: string;
      status: "present" | "absent";
      appeal: { appeal_id: number; status: "pending" | "accepted" | "rejected" } | null;
    }>;
  }>;
}

export interface AppealResponse {
  appeal_id: number;
  session_id: number;
  student_name: string;
  student_id: string;
  course_code: string;
  course_name: string;
  section: string;
  session_date: string | null;
  message: string;
  has_attachment: boolean;
  status: "pending" | "accepted" | "rejected";
  resolved_by_role: "professor" | "admin" | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AppealsResponse {
  appeals: AppealResponse[];
}

export interface DeviceChangeRequestResponse {
  request_id: number;
  student_name: string;
  student_id: string;
  student_email: string;
  reason: string;
  status: "pending" | "granted" | "rejected";
  resolved_at: string | null;
  granted_at: string | null;
  created_at: string;
}

export interface AttendanceScanResponse {
  status: "present" | "already_present";
  session: { course_id: number; course_code: string; section: string };
  distance_meters: number;
}

export interface ProfessorSessionDetailResponse {
  session: NonNullable<ActiveProfessorSessionResponse["session"]>;
}

export interface FlaggedAttemptsResponse {
  attempts: Array<{
    attempt_id: number;
    student_name: string;
    student_id: string;
    reason_code: string | null;
    failures: Array<{ code: string; heading: string }>;
    confidence_score: number | null;
    timestamp: string;
    attempt_count: number;
    review_status: "pending";
  }>;
}

export interface PendingStudentsResponse {
  session: { session_id: number; status: "active" | "ended" };
  students: Array<{ name: string; student_id: string }>;
}

export interface PresentStudentsResponse {
  session: { session_id: number; status: "active" | "ended" };
  students: Array<{ name: string; student_id: string; manual_override: boolean }>;
}

type SignupPayload =
  | {
      name: string;
      email: string;
      password: string;
      role: "student";
      student_id: string;
      department: string;
      semester: number;
    }
  | {
      name: string;
      email: string;
      password: string;
      role: "professor";
      employee_id: string;
      department: string;
    }
  | {
      name: string;
      email: string;
      password: string;
      role: "admin";
      admin_code: string;
    };

export function getApiUrl(): string {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");

  if (!apiUrl) {
    throw new Error("Set EXPO_PUBLIC_API_URL before signing in.");
  }

  return apiUrl;
}

async function request<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await readApiPayload<T>(response);

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload));
  }

  return payload;
}

async function authenticatedGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return readAuthenticatedResponse<T>(response, token);
}

async function authenticatedPatch<T>(path: string, body: object, token: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readAuthenticatedResponse<T>(response, token);
}

async function requestWithToken<T>(path: string, body: object, token: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readAuthenticatedResponse<T>(response, token);
}

async function requestFormWithToken<T>(path: string, formData: FormData, token: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  return readAuthenticatedResponse<T>(response, token);
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", { email, password });
}

export function getStudentProfile(token: string): Promise<StudentProfileResponse> {
  return authenticatedGet<StudentProfileResponse>("/students/profile", token);
}

export function getProfessorProfile(token: string): Promise<ProfessorProfileResponse> {
  return authenticatedGet<ProfessorProfileResponse>("/professors/profile", token);
}

export function getAdminProfile(token: string): Promise<AdminProfileResponse> {
  return authenticatedGet<AdminProfileResponse>("/admin/profile", token);
}

export function getStudentAttendance(token: string): Promise<StudentAttendanceResponse> {
  return authenticatedGet<StudentAttendanceResponse>("/students/attendance", token);
}

export function getProfessorReports(
  token: string,
  options: {
    offset?: number;
    courseId?: number;
    section?: string;
    sort?: "newest" | "oldest";
    dateFrom?: string;
    dateTo?: string;
    timezoneOffsetMinutes?: number;
  } = {}
): Promise<ProfessorReportsResponse> {
  const params = new URLSearchParams({
    limit: "5",
    offset: String(options.offset ?? 0),
    sort: options.sort ?? "newest"
  });
  if (options.courseId && options.section) {
    params.set("course_id", String(options.courseId));
    params.set("section", options.section);
  }
  if (options.dateFrom) params.set("date_from", options.dateFrom);
  if (options.dateTo) params.set("date_to", options.dateTo);
  if (options.timezoneOffsetMinutes !== undefined) params.set("timezone_offset_minutes", String(options.timezoneOffsetMinutes));
  return authenticatedGet<ProfessorReportsResponse>(`/attendance/reports?${params.toString()}`, token);
}

export function getProfessorAnalytics(token: string): Promise<ProfessorAnalyticsResponse> {
  return authenticatedGet<ProfessorAnalyticsResponse>("/attendance/reports/analytics", token);
}

export async function exportProfessorAttendanceCsv(
  token: string,
  selection?: { courseId: number; section: string }
): Promise<{ csv: string; filename: string }> {
  const params = new URLSearchParams();
  if (selection) {
    params.set("course_id", String(selection.courseId));
    params.set("section", selection.section);
  }
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${getApiUrl()}/attendance/reports/export${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const payload = await readApiPayload<ApiErrorResponse>(response);
    if (response.status === 401) {
      clearSessionAfterUnauthorized(token, payload);
    }
    throw new Error(apiErrorMessage(payload));
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "yupresence-attendance.csv";
  return { csv: await response.text(), filename };
}

export function getProfessorAssignments(token: string): Promise<ProfessorAssignmentsResponse> {
  return authenticatedGet<ProfessorAssignmentsResponse>("/attendance/assignments", token);
}

export function getAdminStatistics(token: string): Promise<AdminStatisticsResponse> {
  return authenticatedGet<AdminStatisticsResponse>("/admin/statistics", token);
}

export function getAdminCatalog(token: string): Promise<AdminCatalogResponse> {
  return authenticatedGet<AdminCatalogResponse>("/admin/catalog", token);
}

export function createAdminCourse(token: string, payload: { course_code: string; course_name: string; semester?: number | null; sections: string[] }) {
  return requestWithToken("/admin/create-course", payload, token);
}

export function updateAdminCourse(token: string, courseId: number, payload: { course_code?: string; course_name?: string; semester?: number | null; add_sections?: string[] }) {
  return authenticatedPatch(`/admin/courses/${courseId}`, payload, token);
}

export function createAdminUser(token: string, payload: SignupPayload) {
  return requestWithToken("/auth/signup", payload, token);
}

export function assignAdminProfessor(token: string, payload: { course_id: number; professor_id: number; section: string }) {
  return requestWithToken("/admin/assign-professor", payload, token);
}

export function enrollAdminStudent(token: string, payload: { course_id: number; student_id: number; section: string }) {
  return requestWithToken("/admin/enroll-student", payload, token);
}

export function getActiveProfessorSession(token: string): Promise<ActiveProfessorSessionResponse> {
  return authenticatedGet<ActiveProfessorSessionResponse>("/attendance/active", token);
}

export function getProfessorSessionDetail(token: string, sessionId: number): Promise<ProfessorSessionDetailResponse> {
  return authenticatedGet<ProfessorSessionDetailResponse>(`/attendance/sessions/${sessionId}`, token);
}

export function getFlaggedAttempts(token: string, sessionId: number): Promise<FlaggedAttemptsResponse> {
  return authenticatedGet<FlaggedAttemptsResponse>(`/attendance/sessions/${sessionId}/flagged-attempts`, token);
}

export function getPendingStudents(token: string, sessionId: number): Promise<PendingStudentsResponse> {
  return authenticatedGet<PendingStudentsResponse>(`/attendance/sessions/${sessionId}/pending-students`, token);
}

export function getPresentStudents(token: string, sessionId: number): Promise<PresentStudentsResponse> {
  return authenticatedGet<PresentStudentsResponse>(`/attendance/sessions/${sessionId}/present-students`, token);
}

export function markPendingStudentPresent(token: string, sessionId: number, studentId: string): Promise<{
  status: "present";
  student_id: string;
  manual_override: true;
}> {
  return requestWithToken(`/attendance/sessions/${sessionId}/students/${encodeURIComponent(studentId)}/mark-present`, {}, token);
}

export function markPresentStudentAbsent(token: string, sessionId: number, studentId: string): Promise<{
  status: "pending";
  student_id: string;
  manual_override: true;
}> {
  return requestWithToken(`/attendance/sessions/${sessionId}/students/${encodeURIComponent(studentId)}/mark-absent`, {}, token);
}

export function reviewFlaggedAttempt(token: string, attemptId: number, decision: "accept" | "reject"): Promise<{ status: "accepted" | "rejected" }> {
  return requestWithToken(`/attendance/attempts/${attemptId}/${decision}`, {}, token);
}

export function startAttendance(
  token: string,
  courseId: number,
  section: string,
  location: { latitude: number; longitude: number }
): Promise<{ session: { id: number; course_id: number; section: string; expires_at: string | null } }> {
  return requestWithToken("/attendance/start", {
    course_id: courseId,
    section,
    latitude: location.latitude,
    longitude: location.longitude,
    radius: 40
  }, token);
}

export function endAttendance(token: string, sessionId: number): Promise<{ session: { session_id: number; status: "ended" } }> {
  return requestWithToken("/attendance/end", { session_id: sessionId }, token);
}

export function getStudentCourses(token: string): Promise<StudentCoursesResponse> {
  return authenticatedGet<StudentCoursesResponse>("/students/courses", token);
}

export function submitDeviceChangeRequest(token: string, reason: string): Promise<{ request: { id: number; status: "pending"; reason: string; created_at: string } }> {
  return requestWithToken("/students/device-change-requests", { reason }, token);
}

export function getAdminDeviceChangeRequests(token: string, status: "pending" | "granted" | "rejected" | "all" = "pending"): Promise<{ requests: DeviceChangeRequestResponse[] }> {
  return authenticatedGet<{ requests: DeviceChangeRequestResponse[] }>(`/admin/device-change-requests?status=${status}`, token);
}

export function resolveAdminDeviceChangeRequest(token: string, requestId: number, decision: "grant" | "reject"): Promise<{ status: "granted" | "rejected" }> {
  return requestWithToken(`/admin/device-change-requests/${requestId}/${decision}`, {}, token);
}

export function submitStudentAppeal(
  token: string,
  payload: { sessionId: number; message: string; attachment?: { uri: string; name: string; mimeType: string } }
): Promise<{ appeal: AppealResponse }> {
  const formData = new FormData();
  formData.append("session_id", String(payload.sessionId));
  formData.append("message", payload.message);
  if (payload.attachment) {
    formData.append("attachment", {
      uri: payload.attachment.uri,
      name: payload.attachment.name,
      type: payload.attachment.mimeType
    } as never);
  }
  return requestFormWithToken<{ appeal: AppealResponse }>("/appeals", formData, token);
}

export function getAppeals(token: string, status: "pending" | "accepted" | "rejected" | "all" = "all"): Promise<AppealsResponse> {
  return authenticatedGet<AppealsResponse>(`/appeals?status=${status}`, token);
}

export function resolveAppeal(token: string, appealId: number, decision: "accept" | "reject"): Promise<{ appeal: AppealResponse }> {
  return requestWithToken<{ appeal: AppealResponse }>(`/appeals/${appealId}/${decision}`, {}, token);
}

export function getAppealViewLink(token: string, appealId: number): Promise<{ url: string; mime_type: string }> {
  return requestWithToken<{ url: string; mime_type: string }>(`/appeals/${appealId}/view-link`, {}, token);
}

export function changeStudentPassword(token: string, currentPassword: string, newPassword: string): Promise<{ status: "ok" }> {
  return authenticatedPatch<{ status: "ok" }>("/students/profile/password", {
    current_password: currentPassword,
    new_password: newPassword
  }, token);
}

export function changeProfessorPassword(token: string, currentPassword: string, newPassword: string): Promise<{ status: "ok" }> {
  return authenticatedPatch<{ status: "ok" }>("/professors/profile/password", {
    current_password: currentPassword,
    new_password: newPassword
  }, token);
}

export function changeAdminPassword(token: string, currentPassword: string, newPassword: string): Promise<{ status: "ok" }> {
  return authenticatedPatch<{ status: "ok" }>("/admin/profile/password", {
    current_password: currentPassword,
    new_password: newPassword
  }, token);
}

export function registerStudentDevice(token: string, deviceId: string): Promise<{ status: "bound" | "already_bound" }> {
  return authenticatedPatch<{ status: "bound" | "already_bound" }>("/students/device", { device_id: deviceId }, token);
}

export function scanAttendance(token: string, payload: { qrPayload: string; latitude: number; longitude: number; deviceId: string }): Promise<AttendanceScanResponse> {
  return requestWithToken<AttendanceScanResponse>("/attendance/scan", {
    qr_payload: payload.qrPayload,
    latitude: payload.latitude,
    longitude: payload.longitude,
    device_id: payload.deviceId
  }, token);
}
