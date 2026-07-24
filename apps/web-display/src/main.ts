import QRCode from "qrcode";
import { io, type Socket } from "socket.io-client";

import "./style.css";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3000";
const pollIntervalMs = 3_000;

interface ActiveSession {
  session_id: number;
  course_code: string;
  course_name: string;
  section: string;
  present_count: number;
  pending_count: number;
  flagged_count: number;
  expires_at: string | null;
}

interface LiveUpdate {
  session_id: number;
  qr_payload: string | null;
  present_count: number;
  pending_count: number;
  flagged_count: number;
  remaining_seconds: number;
}

let authToken: string | null = null;
let activeSession: ActiveSession | null = null;
let sessionSocket: Socket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const loginView = element<HTMLElement>("login-view");
const waitingView = element<HTMLElement>("waiting-view");
const sessionView = element<HTMLElement>("session-view");
const loginForm = element<HTMLFormElement>("login-form");
const loginButton = element<HTMLButtonElement>("login-button");
const loginError = element<HTMLElement>("login-error");
const qrCanvas = element<HTMLCanvasElement>("qr-canvas");

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void logIn();
});
element<HTMLButtonElement>("waiting-logout").addEventListener("click", logOut);

async function logIn() {
  loginError.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "Logging in…";

  try {
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: element<HTMLInputElement>("email").value.trim(),
        password: element<HTMLInputElement>("password").value
      })
    });
    const payload = await response.json() as { token?: string; user?: { role?: string }; error?: string };

    if (!response.ok || !payload.token) {
      throw new Error(payload.error ?? "Unable to log in.");
    }
    if (payload.user?.role !== "professor") {
      throw new Error("This display is for professor accounts only.");
    }

    authToken = payload.token;
    showWaiting();
    await checkActiveSession();
    pollTimer = setInterval(() => void checkActiveSession(), pollIntervalMs);
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : "Unable to log in.";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Log in";
  }
}

async function checkActiveSession() {
  if (!authToken) return;

  try {
    const response = await fetch(`${apiUrl}/attendance/active`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (response.status === 401 || response.status === 403) {
      logOut();
      return;
    }
    if (!response.ok) return;

    const payload = await response.json() as { session: ActiveSession | null };
    if (!payload.session) {
      if (activeSession) disconnectSession();
      showWaiting();
      return;
    }

    if (activeSession?.session_id !== payload.session.session_id) {
      connectToSession(payload.session);
    }
  } catch {
    setConnectionState(false, "API unavailable");
  }
}

function connectToSession(session: ActiveSession) {
  disconnectSession();
  activeSession = session;
  element("course-title").textContent = `${session.course_code} — Section ${session.section}`;
  element("course-name").textContent = session.course_name;
  updateCounters(session);
  updateTimer(session.expires_at ? Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 1000)) : 0);
  showSession();
  setConnectionState(false, "Connecting");

  sessionSocket = io(apiUrl, { auth: { token: authToken }, transports: ["websocket"] });
  sessionSocket.on("connect", () => {
    setConnectionState(true, "Live");
    sessionSocket?.emit("attendance:join", { session_id: session.session_id });
  });
  sessionSocket.on("attendance:update", (update: LiveUpdate) => {
    if (update.session_id !== session.session_id) return;
    updateCounters(update);
    updateTimer(update.remaining_seconds);
    if (update.qr_payload) {
      void QRCode.toCanvas(qrCanvas, update.qr_payload, {
        width: 620,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M"
      });
    }
  });
  sessionSocket.on("attendance:ended", ({ session_id }: { session_id: number }) => {
    if (session_id === session.session_id) {
      disconnectSession();
      showWaiting();
      void checkActiveSession();
    }
  });
  sessionSocket.on("attendance:error", ({ error }: { error: string }) => setConnectionState(false, error));
  sessionSocket.on("disconnect", () => setConnectionState(false, "Reconnecting"));
  sessionSocket.on("connect_error", () => setConnectionState(false, "Connection lost"));
}

function disconnectSession() {
  sessionSocket?.disconnect();
  sessionSocket = null;
  activeSession = null;
  qrCanvas.getContext("2d")?.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
}

function logOut() {
  authToken = null;
  disconnectSession();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  show(loginView);
}

function updateCounters(values: { present_count: number; pending_count: number; flagged_count: number }) {
  element("present-count").textContent = String(values.present_count);
  element("pending-count").textContent = String(values.pending_count);
  element("flagged-count").textContent = String(values.flagged_count);
}

function updateTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  element("remaining-time").textContent = `${minutes}:${remainder}`;
}

function setConnectionState(connected: boolean, label: string) {
  element("connection-label").textContent = label;
  element("connection-dot").classList.toggle("connected", connected);
}

function showWaiting() {
  show(waitingView);
}

function showSession() {
  show(sessionView);
}

function show(view: HTMLElement) {
  [loginView, waitingView, sessionView].forEach((item) => item.classList.toggle("hidden", item !== view));
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}
