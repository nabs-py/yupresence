import QRCode from "qrcode";
import { io, type Socket } from "socket.io-client";

import "./style.css";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3000";
const pollIntervalMs = 3_000;
const reviewIntervalMs = 2_000;

interface Assignment { course_id: number; course_code: string; course_name: string; section: string; }
interface Session { session_id: number; course_id: number; course_code: string; course_name: string; section: string; present_count: number; pending_count: number; flagged_count: number; expires_at: string | null; status: "active" | "ended"; }
interface LiveUpdate { session_id: number; qr_payload: string | null; present_count: number; pending_count: number; flagged_count: number; remaining_seconds: number; }
interface Student { name: string; student_id: string; manual_override?: boolean; }
interface FlaggedAttempt { attempt_id: number; student_name: string; student_id: string; failures: Array<{ code: string; heading: string }>; confidence_score: number | null; timestamp: string; attempt_count: number; }
interface ReportSession { session_id: number; course_code: string; course_name: string; section: string; ended_at: string | null; }
interface ReportSection extends Assignment { defaulters: Array<{ name: string; student_id: string; absence_count: number; status: "warning" | "critical"; }>; }
interface Appeal { appeal_id: number; session_id: number; student_name: string; student_id: string; course_code: string; course_name: string; section: string; session_date: string | null; message: string; has_attachment: boolean; status: "pending" | "accepted" | "rejected"; resolved_by_role: "professor" | "admin" | null; resolved_by_name: string | null; }
interface AnalyticsSection extends Assignment { attendance_rate: number; total_sessions: number; enrolled_students: number; tiers: { excellent: number; safe: number; warning: number; critical: number; }; }
interface ProfessorProfile { name: string; email: string; employee_id: string; department: string | null; }

type Page = "home" | "reports" | "profile" | "session";
type ReportTab = "sessions" | "appeals" | "analytics";
interface ReportFilter { sort: "newest" | "oldest"; assignment: Assignment | null; dateFrom: string; dateTo: string; }

let authToken: string | null = null;
let assignments: Assignment[] = [];
let activeSession: Session | null = null;
let reviewSession: Session | null = null;
let currentPage: Page = "home";
let reportTab: ReportTab = "sessions";
let reportFilter: ReportFilter = { sort: "newest", assignment: null, dateFrom: "", dateTo: "" };
let reportSessions: ReportSession[] = [];
let reportSections: ReportSection[] = [];
let reportOffset = 0;
let reportHasMore = false;
let sessionSocket: Socket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reviewTimer: ReturnType<typeof setInterval> | null = null;
let reviewRefreshInFlight = false;

const loginView = element<HTMLElement>("login-view");
const app = element<HTMLElement>("professor-app");
const homeView = element<HTMLElement>("home-view");
const reportsView = element<HTMLElement>("reports-view");
const profileView = element<HTMLElement>("profile-view");
const sessionView = element<HTMLElement>("session-view");
const topNav = element<HTMLElement>("top-nav");
const modalRoot = element<HTMLElement>("modal-root");
const qrCanvas = element<HTMLCanvasElement>("qr-canvas");

element<HTMLFormElement>("login-form").addEventListener("submit", (event) => { event.preventDefault(); void logIn(); });
element<HTMLElement>("assignments-grid").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-start-course]");
  if (button) void startSession(Number(button.dataset.startCourse), button.dataset.startSection ?? "");
});
element<HTMLElement>("reports-content").addEventListener("click", handleReportsClick);
element<HTMLElement>("reports-view").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-report-tab]");
  if (button) { reportTab = button.dataset.reportTab as ReportTab; void loadReportTab(); }
});
profileView.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-profile-action]");
  if (button?.dataset.profileAction === "retry") void loadProfile();
});
profileView.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== "profile-password-form") return;
  event.preventDefault();
  void changeProfilePassword(form);
});
sessionView.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-review-action]");
  if (button?.dataset.reviewAction && button.dataset.reviewId) void reviewAction(button.dataset.reviewAction, button.dataset.reviewId);
});
element<HTMLButtonElement>("end-session-button").addEventListener("click", openEndModal);
element<HTMLButtonElement>("back-to-reports").addEventListener("click", () => navigate("reports"));

async function logIn() {
  const button = element<HTMLButtonElement>("login-button"); const error = element("login-error");
  error.textContent = ""; button.disabled = true; button.textContent = "Logging in…";
  try {
    const response = await fetch(`${apiUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: element<HTMLInputElement>("email").value.trim(), password: element<HTMLInputElement>("password").value }) });
    const payload = await response.json() as { token?: string; user?: { role?: string }; error?: string };
    if (!response.ok || !payload.token) throw new Error(payload.error ?? "Unable to log in.");
    if (payload.user?.role !== "professor") throw new Error("This page is for professor accounts only.");
    authToken = payload.token; await loadAssignments(); await checkActiveSession(); if (!activeSession) navigate("home");
    pollTimer = setInterval(() => void checkActiveSession(), pollIntervalMs);
  } catch (cause) { error.textContent = messageFrom(cause, "Unable to log in."); }
  finally { button.disabled = false; button.textContent = "Log in"; }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!authToken) throw new Error("You are signed out.");
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${authToken}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (response.status === 401 || response.status === 403) { logOut(); throw new Error("Your session has ended. Please sign in again."); }
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

async function loadAssignments() { assignments = (await api<{ assignments: Assignment[] }>("/attendance/assignments")).assignments; renderAssignments(); }

async function checkActiveSession() {
  if (!authToken) return;
  try {
    const session = (await api<{ session: Session | null }>("/attendance/active")).session;
    if (!session) { if (activeSession) disconnectLiveSession(); return; }
    if (activeSession?.session_id !== session.session_id) connectToLiveSession(session);
    else { activeSession = session; if (currentPage === "session" && reviewSession?.session_id === session.session_id) updateCounters(session); }
  } catch { /* A visible page-level request will report the useful error. */ }
}

function navigate(page: Page) {
  currentPage = page;
  [homeView, reportsView, profileView, sessionView].forEach((view) => view.classList.add("hidden"));
  if (!authToken) { app.classList.add("hidden"); loginView.classList.remove("hidden"); return; }
  loginView.classList.add("hidden"); app.classList.remove("hidden");
  if (page === "home") { homeView.classList.remove("hidden"); renderAssignments(); }
  if (page === "reports") { reportsView.classList.remove("hidden"); void loadReportTab(); }
  if (page === "profile") { profileView.classList.remove("hidden"); void loadProfile(); }
  if (page === "session") sessionView.classList.remove("hidden");
  renderTopNav();
}

function renderTopNav() {
  const isHome = currentPage === "home";
  topNav.innerHTML = `<div class="nav-left">${isHome ? `<div class="nav-home-title"><span>YuPresence</span><strong>Professor Home</strong></div>` : `<button class="icon-button" data-nav="home" title="Home" aria-label="Home">${navIcon("home")}</button>`}</div><div class="nav-right"><button class="icon-button ${currentPage === "reports" ? "active" : ""}" data-nav="reports" title="Reports" aria-label="Reports">${navIcon("reports")}</button><button class="icon-button ${currentPage === "profile" ? "active" : ""}" data-nav="profile" title="Profile" aria-label="Profile">${navIcon("profile")}</button><button class="button ghost nav-logout" data-nav="logout" type="button">Log out</button></div>`;
  topNav.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => button.addEventListener("click", () => { const destination = button.dataset.nav; if (destination === "logout") logOut(); else if (destination) navigate(destination as Page); }));
}

function navIcon(name: "home" | "reports" | "profile") {
  const paths = {
    home: `<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />`,
    reports: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /><path d="m3 8 6-4 6 5 6-7" />`,
    profile: `<circle cx="12" cy="8" r="3.5" /><path d="M4.5 21c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" />`
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9">${paths[name]}</svg>`;
}

async function loadProfile() {
  profileView.innerHTML = `<div class="page-heading profile-heading"><p class="brand-mark">YuPresence</p><h1>Profile</h1></div>${loadingState("Loading your account…")}`;
  try {
    const profile = await api<ProfessorProfile>("/professors/profile");
    if (currentPage !== "profile") return;
    renderProfile(profile);
  } catch (cause) {
    if (currentPage !== "profile" || !authToken) return;
    profileView.innerHTML = `<div class="page-heading profile-heading"><p class="brand-mark">YuPresence</p><h1>Profile</h1></div>${errorState(messageFrom(cause, "Unable to load your account."), "retry-profile")}`;
  }
}

function renderProfile(profile: ProfessorProfile) {
  const initial = profile.name.trim().charAt(0).toUpperCase() || "P";
  const department = profile.department?.trim() || "Not specified";
  profileView.innerHTML = `
    <div class="page-heading profile-heading">
      <p class="brand-mark">YuPresence</p>
      <h1>Profile</h1>
    </div>
    <div class="profile-layout">
      <article class="card profile-summary-card">
        <div class="profile-identity">
          <div class="profile-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
          <div class="profile-title">
            <h2>${escapeHtml(profile.name)}</h2>
            <p title="${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</p>
          </div>
        </div>
        <dl class="profile-details">
          <div><dt>Employee ID</dt><dd>${escapeHtml(profile.employee_id)}</dd></div>
          <div><dt>Department</dt><dd>${escapeHtml(department)}</dd></div>
        </dl>
      </article>
      <section class="card password-card" aria-labelledby="change-password-title">
        <p class="eyebrow">Account security</p>
        <h2 id="change-password-title">Change password</h2>
        <form id="profile-password-form" class="password-form">
          <label>Current password<input id="profile-current-password" name="current_password" type="password" autocomplete="current-password" required minlength="1" maxlength="72" /></label>
          <label>New password<input id="profile-new-password" name="new_password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" /></label>
          <label>Confirm new password<input id="profile-confirm-password" name="confirm_password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" /></label>
          <p id="profile-password-message" class="form-message" role="status"></p>
          <button id="profile-password-submit" class="button primary" type="submit">Update password</button>
        </form>
      </section>
    </div>`;
}

async function changeProfilePassword(form: HTMLFormElement) {
  const message = element("profile-password-message");
  const submit = element<HTMLButtonElement>("profile-password-submit");
  const currentPassword = element<HTMLInputElement>("profile-current-password").value;
  const newPassword = element<HTMLInputElement>("profile-new-password").value;
  const confirmPassword = element<HTMLInputElement>("profile-confirm-password").value;
  message.textContent = "";
  message.className = "form-message";
  if (newPassword !== confirmPassword) {
    message.textContent = "New passwords do not match.";
    message.classList.add("error");
    return;
  }
  submit.disabled = true;
  submit.textContent = "Updating…";
  try {
    await api("/professors/profile/password", { method: "PATCH", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
    form.reset();
    message.textContent = "Password updated successfully.";
    message.classList.add("success");
  } catch (cause) {
    message.textContent = messageFrom(cause, "Unable to update your password.");
    message.classList.add("error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Update password";
  }
}

function renderAssignments() {
  const container = element<HTMLElement>("assignments-grid");
  if (!assignments.length) { container.innerHTML = emptyState("No teaching assignments are available yet."); return; }
  container.innerHTML = assignments.map((item) => `<article class="assignment-card card"><p class="course-code">${escapeHtml(item.course_code)}</p><h3>Section ${escapeHtml(item.section)}</h3><p>${escapeHtml(item.course_name)}</p><button class="button primary" type="button" data-start-course="${item.course_id}" data-start-section="${escapeHtml(item.section)}">Start Attendance</button></article>`).join("");
}

async function startSession(courseId: number, section: string) {
  const error = element("home-error"); error.textContent = "";
  const button = document.querySelector<HTMLButtonElement>(`[data-start-course="${courseId}"][data-start-section="${CSS.escape(section)}"]`);
  if (!navigator.geolocation) { error.textContent = "This browser does not support location. Use a browser with location access to start attendance."; return; }
  if (button) { button.disabled = true; button.textContent = "Getting location…"; }
  try {
    const position = await browserLocation(); if (button) button.textContent = "Starting…";
    await api("/attendance/start", { method: "POST", body: JSON.stringify({ course_id: courseId, section, latitude: position.coords.latitude, longitude: position.coords.longitude, radius: 40 }) });
    await checkActiveSession();
  } catch (cause) { error.textContent = messageFrom(cause, "Unable to start attendance."); }
  finally { if (button) { button.disabled = false; button.textContent = "Start Attendance"; } }
}

function browserLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? "Location permission is required to start attendance." : error.code === error.TIMEOUT ? "Location took too long. Try again near a window or with Wi-Fi enabled." : "Unable to determine this laptop's location.")), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 }));
}

function connectToLiveSession(session: Session) {
  disconnectLiveSession(); activeSession = session; showSession(session, true);
  sessionSocket = io(apiUrl, { auth: { token: authToken }, transports: ["websocket"] });
  sessionSocket.on("connect", () => { setConnectionState(true, "Live"); sessionSocket?.emit("attendance:join", { session_id: session.session_id }); });
  sessionSocket.on("attendance:update", (update: LiveUpdate) => {
    if (update.session_id !== session.session_id) return;
    updateCounters(update); updateTimer(update.remaining_seconds); void refreshReview();
    if (update.qr_payload) void QRCode.toCanvas(qrCanvas, update.qr_payload, { width: 720, margin: 2, color: { dark: "#000000", light: "#ffffff" }, errorCorrectionLevel: "M" });
  });
  sessionSocket.on("attendance:ended", ({ session_id }: { session_id: number }) => { if (session_id === session.session_id) { disconnectLiveSession(); navigate("home"); } });
  sessionSocket.on("connect_error", () => setConnectionState(false, "Connection lost")); sessionSocket.on("disconnect", () => setConnectionState(false, "Reconnecting"));
  reviewTimer = setInterval(() => void refreshReview(), reviewIntervalMs); void refreshReview();
}

function disconnectLiveSession() { sessionSocket?.disconnect(); sessionSocket = null; activeSession = null; if (reviewTimer) clearInterval(reviewTimer); reviewTimer = null; if (reviewSession?.status === "active") reviewSession = null; }

function showSession(session: Session, live: boolean) {
  reviewSession = session; currentPage = "session"; navigate("session");
  element("course-title").textContent = `${session.course_code} — Section ${session.section}`; element("course-name").textContent = session.course_name;
  element("session-eyebrow").textContent = live ? "Live attendance" : "Past session";
  element<HTMLButtonElement>("end-session-button").classList.toggle("hidden", !live);
  element<HTMLButtonElement>("back-to-reports").classList.toggle("hidden", live);
  element("session-hero").classList.toggle("past-session", !live);
  element("timer-label").textContent = live ? "Time remaining" : "Session complete";
  updateCounters(session); updateTimer(live && session.expires_at ? Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 1000)) : 0);
  setConnectionState(live, live ? "Connecting" : "Ended"); if (!live) qrCanvas.getContext("2d")?.clearRect(0, 0, qrCanvas.width, qrCanvas.height); void refreshReview();
}

async function openPastSession(sessionId: number) {
  try { const payload = await api<{ session: Session }>(`/attendance/sessions/${sessionId}`); showSession(payload.session, false); }
  catch (cause) { openModal(`<p class="brand-mark">Reports</p><h2>Unable to open session</h2><p>${escapeHtml(messageFrom(cause, "Please try again."))}</p><div class="modal-actions"><button class="button primary" data-modal-close type="button">Close</button></div>`); }
}

async function refreshReview() {
  if (!reviewSession || reviewRefreshInFlight) return; reviewRefreshInFlight = true;
  try {
    const id = reviewSession.session_id;
    const [present, pending, flagged] = await Promise.all([api<{ students: Student[] }>(`/attendance/sessions/${id}/present-students`), api<{ students: Student[] }>(`/attendance/sessions/${id}/pending-students`), api<{ attempts: FlaggedAttempt[] }>(`/attendance/sessions/${id}/flagged-attempts`)]);
    if (reviewSession?.session_id === id) renderReview(present.students, pending.students, flagged.attempts);
  } catch (cause) { if (authToken) element("review-error").textContent = messageFrom(cause, "Unable to refresh attendance follow-up."); }
  finally { reviewRefreshInFlight = false; }
}

function renderReview(present: Student[], pending: Student[], flagged: FlaggedAttempt[]) {
  element("present-list-count").textContent = String(present.length); element("pending-list-count").textContent = String(pending.length); element("flagged-list-count").textContent = String(flagged.length);
  element("present-list").innerHTML = present.length ? present.map((student) => studentRow(student.name, student.student_id, "Mark Absent", "mark-absent", false)).join("") : emptyState("No students are marked present.");
  element("pending-list").innerHTML = pending.length ? pending.map((student) => studentRow(student.name, student.student_id, "Mark Present", "mark-present", true)).join("") : emptyState("Everyone is accounted for.");
  element("flagged-list").innerHTML = flagged.length ? flagged.map((attempt) => `<article class="review-row flagged-row"><div class="student-detail"><strong>${escapeHtml(attempt.student_name)}</strong><span>Student ID: ${escapeHtml(attempt.student_id)}</span><b>${attempt.confidence_score ?? 5}% confidence</b>${attempt.failures.map((failure) => `<em>${escapeHtml(failure.heading)}</em>`).join("")}<span>${attempt.attempt_count} ${attempt.attempt_count === 1 ? "attempt" : "attempts"}</span></div><div class="row-actions"><button class="button ghost compact" data-review-action="reject" data-review-id="${attempt.attempt_id}" type="button">Reject</button><button class="button primary compact" data-review-action="accept" data-review-id="${attempt.attempt_id}" type="button">Accept</button></div></article>`).join("") : emptyState("No flagged attempts to review.");
}

function studentRow(name: string, studentId: string, label: string, action: string, primary: boolean) { return `<article class="review-row"><div class="student-detail"><strong>${escapeHtml(name)}</strong><span>Student ID: ${escapeHtml(studentId)}</span></div><button class="button ${primary ? "primary" : "ghost"} compact" data-review-action="${action}" data-review-id="${escapeHtml(studentId)}" type="button">${label}</button></article>`; }

async function reviewAction(action: string, id: string) {
  if (!reviewSession) return; element("review-error").textContent = "";
  try {
    const base = `/attendance/sessions/${reviewSession.session_id}/students/${encodeURIComponent(id)}`;
    if (action === "mark-present") await api(`${base}/mark-present`, { method: "POST", body: "{}" });
    if (action === "mark-absent") await api(`${base}/mark-absent`, { method: "POST", body: "{}" });
    if (action === "accept" || action === "reject") await api(`/attendance/attempts/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
    await refreshReview(); await loadReports(false);
  } catch (cause) { element("review-error").textContent = messageFrom(cause, "Unable to update attendance."); }
}

async function loadReportTab() { if (reportTab === "sessions") await loadReports(true); if (reportTab === "appeals") await loadAppeals(); if (reportTab === "analytics") await loadAnalytics(); }

function updateReportSidebar() {
  element<HTMLElement>("reports-view").querySelectorAll("[data-report-tab]").forEach((button) => {
    button.classList.toggle("active", (button as HTMLElement).dataset.reportTab === reportTab);
  });
}

async function loadReports(reset: boolean) {
  const content = element("reports-content"); if (reset) { reportOffset = 0; reportSessions = []; content.innerHTML = loadingState("Loading past sessions…"); }
  const params = new URLSearchParams({ limit: "5", offset: String(reportOffset), sort: reportFilter.sort, timezone_offset_minutes: String(new Date().getTimezoneOffset()) });
  if (reportFilter.assignment) { params.set("course_id", String(reportFilter.assignment.course_id)); params.set("section", reportFilter.assignment.section); }
  if (reportFilter.dateFrom) params.set("date_from", reportFilter.dateFrom); if (reportFilter.dateTo) params.set("date_to", reportFilter.dateTo);
  try {
    const data = await api<{ sections: ReportSection[]; recent_sessions: ReportSession[]; pagination: { has_more: boolean; offset: number; limit: number } }>(`/attendance/reports?${params.toString()}`);
    reportSections = data.sections; reportSessions = reset ? data.recent_sessions : [...reportSessions, ...data.recent_sessions]; reportOffset = data.pagination.offset + data.pagination.limit; reportHasMore = data.pagination.has_more; renderReports();
  } catch (cause) { content.innerHTML = errorState(messageFrom(cause, "Unable to load reports."), "retry-reports"); }
}

function renderReports() {
  updateReportSidebar();
  const content = element<HTMLElement>("reports-content");
  if (reportTab === "sessions") {
    const filterLabel = reportFilter.assignment ? `${reportFilter.assignment.course_code} · ${reportFilter.assignment.section}` : "All sections";
    const watchlist = reportSections.flatMap((section) => section.defaulters.map((student) => ({ ...student, section })));
    content.innerHTML = `<header class="content-header"><div><p class="brand-mark">Reports</p><h1>Past Sessions</h1></div><div class="content-actions"><button class="button ghost" data-report-action="filter" type="button">Sort & Filter</button><button class="button primary" data-report-action="export" type="button">Export PDF</button></div></header><p class="filter-summary">${escapeHtml(filterLabel)} · ${reportFilter.sort === "newest" ? "Newest first" : "Oldest first"}${reportFilter.dateFrom ? ` · From ${reportFilter.dateFrom}` : ""}${reportFilter.dateTo ? ` · Through ${reportFilter.dateTo}` : ""}</p><div class="session-grid">${reportSessions.length ? reportSessions.map((session) => `<button class="report-session-card card" data-report-action="open-session" data-session-id="${session.session_id}" type="button"><strong>${escapeHtml(session.course_code)} · Section ${escapeHtml(session.section)}</strong><span>${escapeHtml(session.course_name)}</span><small>${formatDate(session.ended_at)}</small></button>`).join("") : emptyState("No ended sessions match this filter.")}</div>${reportHasMore ? `<button class="button ghost load-more" data-report-action="load-more" type="button">Load More</button>` : ""}<section class="watchlist"><h2>Attendance Watchlist</h2>${watchlist.length ? `<div class="watchlist-grid">${watchlist.map((student) => `<article class="watch-row card"><div><strong>${escapeHtml(student.name)}</strong><span>Student ID: ${escapeHtml(student.student_id)} · ${escapeHtml(student.section.course_code)} · Section ${escapeHtml(student.section.section)}</span></div><b class="tier ${student.status}">${student.absence_count} · ${student.status === "critical" ? "Critical / DN" : "Warning"}</b></article>`).join("")}</div>` : emptyState("No students are currently in Warning or Critical / DN.")}</section>`;
  }
}

async function loadAppeals() {
  const content = element("reports-content"); content.innerHTML = loadingState("Loading appeals…");
  try { const data = await api<{ appeals: Appeal[] }>("/appeals?status=all"); renderAppeals(data.appeals); }
  catch (cause) { content.innerHTML = errorState(messageFrom(cause, "Unable to load appeals."), "retry-appeals"); }
}

function renderAppeals(appeals: Appeal[]) {
  updateReportSidebar();
  const content = element("reports-content"); content.innerHTML = `<header class="content-header"><div><p class="brand-mark">Reports</p><h1>Appeals</h1></div></header>${appeals.length ? `<div class="appeal-list">${appeals.map((appeal) => `<article class="appeal-card card"><div class="appeal-top"><div><strong>${escapeHtml(appeal.student_name)}</strong><span>Student ID: ${escapeHtml(appeal.student_id)} · ${escapeHtml(appeal.course_code)} · Section ${escapeHtml(appeal.section)}</span></div><b class="status-pill ${appeal.status}">${escapeHtml(appeal.status)}</b></div><small>${formatDate(appeal.session_date)}</small><p>${escapeHtml(appeal.message)}</p>${appeal.has_attachment ? `<button class="text-button" data-report-action="view-attachment" data-appeal-id="${appeal.appeal_id}" type="button">View attachment</button>` : ""}${appeal.status === "pending" ? `<div class="row-actions"><button class="button ghost compact" data-report-action="resolve-appeal" data-decision="reject" data-appeal-id="${appeal.appeal_id}" type="button">Reject</button><button class="button primary compact" data-report-action="resolve-appeal" data-decision="accept" data-appeal-id="${appeal.appeal_id}" type="button">Accept</button></div>` : `<span class="resolved">${appeal.resolved_by_name ? `Resolved by ${appeal.resolved_by_role === "admin" ? "Admin" : "Professor"} ${escapeHtml(appeal.resolved_by_name)}` : "Resolved"}</span>`}</article>`).join("")}</div>` : emptyState("No attendance appeals to review.")}`;
}

async function loadAnalytics() {
  const content = element("reports-content"); content.innerHTML = loadingState("Loading analytics…");
  try { const data = await api<{ sections: AnalyticsSection[] }>("/attendance/reports/analytics"); renderAnalytics(data.sections); }
  catch (cause) { content.innerHTML = errorState(messageFrom(cause, "Unable to load analytics."), "retry-analytics"); }
}

function renderAnalytics(sections: AnalyticsSection[]) {
  updateReportSidebar();
  const content = element("reports-content"); content.innerHTML = `<header class="content-header"><div><p class="brand-mark">Reports</p><h1>Analytics</h1></div></header>${sections.length ? `<div class="analytics-grid">${sections.map((section) => `<article class="analytics-card card"><strong>${escapeHtml(section.course_code)} · Section ${escapeHtml(section.section)}</strong><span>${escapeHtml(section.course_name)}</span><div class="analytics-rate">${section.attendance_rate}%<small>overall attendance</small></div><div class="metrics"><span><b>${section.total_sessions}</b>Sessions</span><span><b>${section.enrolled_students}</b>Students</span></div><div class="tier-grid"><span><b>${section.tiers.excellent}</b>Excellent</span><span><b>${section.tiers.safe}</b>Safe</span><span><b>${section.tiers.warning}</b>Warning</span><span class="critical"><b>${section.tiers.critical}</b>Critical / DN</span></div></article>`).join("")}</div>` : emptyState("No analytics yet. Your teaching sections will appear here once assigned.")}`;
}

function handleReportsClick(event: Event) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-report-action]"); if (!button) return;
  const action = button.dataset.reportAction;
  if (action === "filter") openFilterModal(); if (action === "export") openExportModal(); if (action === "load-more") { void loadReports(false); }
  if (action === "open-session" && button.dataset.sessionId) void openPastSession(Number(button.dataset.sessionId));
  if (action === "retry-reports") void loadReports(true); if (action === "retry-appeals") void loadAppeals(); if (action === "retry-analytics") void loadAnalytics();
  if (action === "resolve-appeal" && button.dataset.appealId && button.dataset.decision) void resolveAppeal(Number(button.dataset.appealId), button.dataset.decision as "accept" | "reject");
  if (action === "view-attachment" && button.dataset.appealId) void viewAttachment(Number(button.dataset.appealId));
}

function openFilterModal() {
  const options = [`<option value="">All sections</option>`, ...assignments.map((item) => `<option value="${item.course_id}:${escapeHtml(item.section)}" ${reportFilter.assignment?.course_id === item.course_id && reportFilter.assignment.section === item.section ? "selected" : ""}>${escapeHtml(item.course_code)} — Section ${escapeHtml(item.section)}</option>`)].join("");
  openModal(`<p class="brand-mark">Reports</p><h2>Sort & Filter</h2><label>Order<select id="filter-sort"><option value="newest" ${reportFilter.sort === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${reportFilter.sort === "oldest" ? "selected" : ""}>Oldest first</option></select></label><label>Course-section<select id="filter-section">${options}</select></label><div class="date-row"><label>From<input id="filter-from" type="date" value="${reportFilter.dateFrom}" /></label><label>Through<input id="filter-to" type="date" value="${reportFilter.dateTo}" /></label></div><p id="filter-error" class="error"></p><div class="modal-actions"><button class="button ghost" data-modal-action="reset-filter" type="button">Reset</button><button class="button primary" data-modal-action="apply-filter" type="button">Apply</button></div>`);
}

function openExportModal() { openModal(`<p class="brand-mark">Reports</p><h2>Export absence report</h2><p>Choose one course-section for the official PDF.</p><div class="modal-options">${assignments.map((item) => `<button class="modal-option" data-modal-action="export-pdf" data-course-id="${item.course_id}" data-section="${escapeHtml(item.section)}" type="button"><strong>${escapeHtml(item.course_code)} · Section ${escapeHtml(item.section)}</strong><span>${escapeHtml(item.course_name)}</span></button>`).join("")}</div><div class="modal-actions"><button class="button ghost" data-modal-close type="button">Cancel</button></div>`); }

function openEndModal() { if (!activeSession) return; openModal(`<p class="brand-mark">YuPresence</p><h2>End this session?</h2><p>Students will no longer be able to check in.</p><p id="end-error" class="error"></p><div class="modal-actions"><button class="button ghost" data-modal-close type="button">Cancel</button><button class="button primary" data-modal-action="end-session" type="button">End Session</button></div>`); }

function openModal(content: string) { modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal-card">${content}</section></div>`; modalRoot.classList.remove("hidden"); modalRoot.querySelector(".modal-backdrop")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(); }); modalRoot.querySelectorAll<HTMLButtonElement>("[data-modal-close]").forEach((button) => button.addEventListener("click", closeModal)); modalRoot.querySelectorAll<HTMLButtonElement>("[data-modal-action]").forEach((button) => button.addEventListener("click", () => void modalAction(button))); }
function closeModal() { modalRoot.classList.add("hidden"); modalRoot.innerHTML = ""; }
async function modalAction(button: HTMLButtonElement) {
  const action = button.dataset.modalAction;
  if (action === "apply-filter") { const sort = element<HTMLSelectElement>("filter-sort").value as "newest" | "oldest"; const value = element<HTMLSelectElement>("filter-section").value; const [courseId, section] = value.split(":"); const dateFrom = element<HTMLInputElement>("filter-from").value; const dateTo = element<HTMLInputElement>("filter-to").value; if (dateFrom && dateTo && dateFrom > dateTo) { element("filter-error").textContent = "The end date must be on or after the start date."; return; } reportFilter = { sort, assignment: value ? assignments.find((item) => item.course_id === Number(courseId) && item.section === section) ?? null : null, dateFrom, dateTo }; closeModal(); await loadReports(true); }
  if (action === "reset-filter") { reportFilter = { sort: "newest", assignment: null, dateFrom: "", dateTo: "" }; closeModal(); await loadReports(true); }
  if (action === "export-pdf") await exportPdf(Number(button.dataset.courseId), button.dataset.section ?? "");
  if (action === "end-session") await endSession();
}

async function exportPdf(courseId: number, section: string) { try { const response = await fetch(`${apiUrl}/attendance/reports/export/pdf?${new URLSearchParams({ course_id: String(courseId), section })}`, { headers: { Authorization: `Bearer ${authToken}` } }); if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "Unable to export PDF."); const blob = await response.blob(); const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "yupresence-absence-report.pdf"; const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); closeModal(); } catch (cause) { const error = modalRoot.querySelector<HTMLElement>(".error"); if (error) error.textContent = messageFrom(cause, "Unable to export PDF."); } }
async function endSession() { if (!activeSession) return; try { await api("/attendance/end", { method: "POST", body: JSON.stringify({ session_id: activeSession.session_id }) }); closeModal(); disconnectLiveSession(); navigate("home"); } catch (cause) { const error = modalRoot.querySelector<HTMLElement>(".error"); if (error) error.textContent = messageFrom(cause, "Unable to end this session."); } }
async function resolveAppeal(id: number, decision: "accept" | "reject") { try { await api(`/appeals/${id}/${decision}`, { method: "POST", body: "{}" }); await loadAppeals(); } catch (cause) { openModal(`<p class="brand-mark">Appeals</p><h2>Unable to resolve appeal</h2><p>${escapeHtml(messageFrom(cause, "Please try again."))}</p><div class="modal-actions"><button class="button primary" data-modal-close type="button">Close</button></div>`); } }
async function viewAttachment(id: number) { try { const attachment = await api<{ url: string; mime_type: string }>(`/appeals/${id}/view-link`, { method: "POST", body: "{}" }); if (attachment.mime_type.startsWith("image/")) openModal(`<p class="brand-mark">Appeal attachment</p><img class="attachment-image" src="${escapeHtml(attachment.url)}" alt="Appeal attachment" /><div class="modal-actions"><button class="button ghost" data-modal-close type="button">Close</button></div>`); else if (attachment.mime_type === "application/pdf") openModal(`<p class="brand-mark">Appeal attachment</p><iframe class="attachment-pdf" src="${escapeHtml(attachment.url)}" title="Appeal attachment PDF"></iframe><div class="modal-actions"><button class="button ghost" data-modal-close type="button">Close</button></div>`); else throw new Error("This attachment format cannot be previewed."); } catch (cause) { openModal(`<p class="brand-mark">Appeal attachment</p><h2>Unable to open attachment</h2><p>${escapeHtml(messageFrom(cause, "Please try again."))}</p><div class="modal-actions"><button class="button primary" data-modal-close type="button">Close</button></div>`); } }

function updateCounters(values: { present_count: number; pending_count: number; flagged_count: number }) { updateCounter("present-count", values.present_count); updateCounter("pending-count", values.pending_count); updateCounter("flagged-count", values.flagged_count); }
function updateCounter(id: string, value: number) { const node = element(id); if (node.textContent !== String(value)) { node.classList.remove("counter-updated"); requestAnimationFrame(() => node.classList.add("counter-updated")); } node.textContent = String(value); }
function updateTimer(seconds: number) { element("remaining-time").textContent = seconds ? `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}` : "—"; }
function setConnectionState(connected: boolean, label: string) { element("connection-label").textContent = label; element("connection-dot").classList.toggle("connected", connected); }
function logOut() { authToken = null; disconnectLiveSession(); reviewSession = null; if (pollTimer) clearInterval(pollTimer); pollTimer = null; modalRoot.classList.add("hidden"); app.classList.add("hidden"); loginView.classList.remove("hidden"); }
function loadingState(text: string) { return `<div class="state-card card"><p>${escapeHtml(text)}</p></div>`; } function errorState(text: string, action: string) { return `<div class="state-card card"><p>${escapeHtml(text)}</p><button class="button primary" data-report-action="${action}" type="button">Retry</button></div>`; } function emptyState(text: string) { return `<p class="empty-state">${escapeHtml(text)}</p>`; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Date unavailable"; }
function messageFrom(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; } function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); } function element<T extends HTMLElement = HTMLElement>(id: string): T { const found = document.getElementById(id); if (!found) throw new Error(`Missing element: ${id}`); return found as T; }
