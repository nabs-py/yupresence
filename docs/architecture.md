# YuPresence — Architecture & Build Plan
### Canonical Reference for AI Coding Assistants (Claude Code / Cursor / etc.)

> This document is the single source of truth for the YuPresence project.
> If any other document conflicts with this one, this one wins.
>
> **Revision note:** this version supersedes the original SmartAttend spec.
> Two structural changes from the original plan: (1) courses now have
> **sections**, tracked at the enrollment/teaching/session level, and (2)
> there is **no public sign-up screen** — accounts are provisioned by admin
> or the seed script, mirroring how a real university issues accounts.

---

## 1. What This App Is

YuPresence is a proxy-resistant university attendance system. A professor
starts a class session for one specific course **section** they teach; a QR
code on their screen rotates every 10 seconds; students scan it with their
phone; the backend runs the scan through a validation pipeline (token
freshness → device identity → course+section enrollment → GPS geofence →
duplicate check) before marking attendance. Everything updates live via
WebSockets. Students and professors get minimal, Apple-inspired dashboards.

**Core promise to solve:** friends can't scan for each other, a
screenshotted QR is useless within seconds, and a student in the wrong
section can't accidentally (or deliberately) check into someone else's class.

---

## 2. Tech Stack (Locked)

| Layer | Choice |
|---|---|
| Mobile app | React Native + Expo |
| Styling | NativeWind (Tailwind for RN) |
| Realtime | Socket.io (client + server) |
| Location | Expo Location |
| Camera/QR scan | Expo Camera |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma |
| Auth | JWT + bcrypt (custom, no third-party auth provider) |
| DB | PostgreSQL (Docker) |
| Local dev | Docker Compose (Postgres + backend containers) |
| Future hosting | Render / Railway / managed Postgres |

**Explicitly NOT in scope for MVP** (deferred, do not build unless told
otherwise): BLE mesh verification, Wi-Fi heatmaps, accelerometer/"ghost
scan" detection, voice check-in, facial verification, ML-based defaulter
prediction, LMS integration. The warning system is simple threshold-based,
not predictive.

---

## 3. Roles & Permissions

### Student
- Login only (no self-signup — account provisioned by admin/seed)
- Enrolled in exactly **one section per course**
- Scan attendance (camera + GPS)
- View own attendance %, streak, warnings, course history
- Manage own profile / change password / logout

### Professor
- Login only (no self-signup)
- Can teach **multiple sections**, including multiple sections of the same
  course (e.g. CS101-287 and CS101-591 both taught by the same professor)
- Start/end attendance sessions — must select course **and section**
  explicitly, never ambiguous
- View live QR, live present/pending/flagged counters, session timer
- Export attendance reports, scoped only to sections they actually teach

### Admin
- Login only (no self-signup — admin accounts provisioned via seed or a
  higher trust process outside the app)
- **The only in-app path that creates new accounts** (professors, students)
- Manages courses and their sections
- Assigns professors to course-sections (course_professors)
- Enrolls students into exactly one section per course (course_students)
- Views system-wide statistics

Role is fixed at account creation and encoded in the JWT. Every protected
route checks role before executing.

---

## 4. UI Structure (Apple-inspired: black/white/grey, max 3 pages per role)

**Student:** Home → Courses → Profile
**Professor:** Home → Reports → Profile
**Admin:** (not UI-constrained the same way — internal tool, can have more views)

Home screens are dashboards-first — the point of the whole app is glanceable
status, not deep navigation. The Student Home keeps a large overall presence
number as its dominant element: total present sessions divided by total
sessions across every enrolled course-section. Directly below it, a compact
row per enrolled course shows the course code and raw absence count for that
course-section. Warning and Critical rows are visually distinguished, while
the existing warning callouts remain visible only for active warnings.
Sign-in is the only screen in the `(auth)` group — there is no sign-up screen
on mobile.

Professor Reports has four deliberately separate flows:

- **Past sessions:** five ended sessions per page, newest first by default, with
  a combined sort/filter sheet for Newest/Oldest order, an exact
  course-section filter, and an optional date or date-range filter. **Load
  More** preserves all applied options. Selecting a session opens the existing
  detail view with the same Present/Pending/Flagged summary and manual review
  controls as the live session, except no QR is shown.
- **Attendance watchlist:** Warning (6–7 absences) and Critical (8+ absences)
  students appear together but with clearly distinct severity labels. Each row
  shows only the student's name, university student ID, course-section, and raw
  absence count.
- **Analytics:** a separate summary screen displays each taught course-section
  independently, including aggregate attendance rate across ended sessions,
  sessions held, enrolled students, and Excellent/Safe/Warning/Critical counts.
- **Export:** a separate chooser exports one taught course-section or all taught
  sections as CSV. Each ended session is expanded per enrolled student with
  name, university student ID, Gregorian/ISO session date, and present/absent
  status. Backend assignment checks prevent cross-section export.

All Reports data is scoped from the authenticated professor's exact
`course_professors(course_id, section)` assignments. Sections of the same
course are never merged.

---

## 5. Database Schema

All tables below, in creation order (respecting foreign keys). **Section
columns are new** — flagged inline.

```sql
-- users: base identity for all roles
users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR NOT NULL,
  email         VARCHAR UNIQUE NOT NULL,
  password      VARCHAR NOT NULL,   -- bcrypt hash
  role          VARCHAR NOT NULL,   -- 'student' | 'professor' | 'admin'
  created_at    TIMESTAMP DEFAULT NOW()
);

-- students: extends users
students (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) UNIQUE,
  student_id    VARCHAR UNIQUE NOT NULL,  -- university roll number
  department    VARCHAR,
  semester      INTEGER,
  device_id     VARCHAR              -- bound on first login, nullable until then
  -- NOTE: the old flat `section` field on this table is gone. Section is
  -- now tracked per-course via course_students.section, since a student's
  -- section differs per course, not globally.
);

-- professors: extends users
professors (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) UNIQUE,
  employee_id   VARCHAR UNIQUE NOT NULL,
  department    VARCHAR
);

-- admins: extends users
admins (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) UNIQUE,
  admin_code    VARCHAR
);

-- courses
courses (
  id            SERIAL PRIMARY KEY,
  course_name   VARCHAR NOT NULL,
  course_code   VARCHAR UNIQUE NOT NULL,
  semester      INTEGER
);

-- course_sections: persistent catalog of valid sections for each course.
-- A section may exist before anyone is assigned or enrolled in it.
course_sections (
  id            SERIAL PRIMARY KEY,
  course_id     INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  section       VARCHAR NOT NULL,
  UNIQUE(course_id, section)
);

-- course_students: enrollment — ONE section per course per student
course_students (
  id            SERIAL PRIMARY KEY,
  course_id     INTEGER REFERENCES courses(id),
  student_id    INTEGER REFERENCES students(id),
  section       VARCHAR NOT NULL,   -- ★ NEW: e.g. '287'
  UNIQUE(course_id, student_id)     -- a student has exactly one row (one section) per course
);

-- course_professors: who teaches what — a professor may teach MULTIPLE
-- sections of the SAME course, so section is part of the uniqueness key
course_professors (
  id            SERIAL PRIMARY KEY,
  course_id     INTEGER REFERENCES courses(id),
  professor_id  INTEGER REFERENCES professors(id),
  section       VARCHAR NOT NULL,   -- ★ NEW: e.g. '591'
  UNIQUE(course_id, professor_id, section)
);

-- attendance_sessions: one row per "class taken today" — tied to ONE section
attendance_sessions (
  id            SERIAL PRIMARY KEY,
  course_id     INTEGER REFERENCES courses(id),
  professor_id  INTEGER REFERENCES professors(id),
  section       VARCHAR NOT NULL,   -- ★ NEW: which section this session is for
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius        INTEGER DEFAULT 40,     -- meters, 30-50 recommended
  qr_token      VARCHAR,                -- current active token (rotates)
  previous_qr_token VARCHAR,            -- immediately previous token only
  previous_qr_token_rotated_at TIMESTAMP, -- previous token is accepted for 3 seconds only
  status        VARCHAR DEFAULT 'active', -- 'active' | 'ended'
  created_at    TIMESTAMP DEFAULT NOW(),
  expires_at    TIMESTAMP               -- session-level expiry, not per-token
);

-- attendance: confirmed presence only; failed scans never write here
attendance (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER REFERENCES attendance_sessions(id),
  student_id    INTEGER REFERENCES students(id),
  status        VARCHAR NOT NULL,   -- always 'present'
  manual_override BOOLEAN DEFAULT FALSE, -- true when accepted by professor
  timestamp     TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, student_id)    -- prevents duplicate marks
);

-- scan_attempts: append-only audit trail; retries are intentionally allowed
scan_attempts (
  id                    SERIAL PRIMARY KEY,
  session_id            INTEGER REFERENCES attendance_sessions(id), -- nullable for malformed QR
  student_id            INTEGER REFERENCES students(id),
  result                VARCHAR NOT NULL, -- 'success' | 'failed'
  reason_code           VARCHAR,          -- e.g. SECTION_MISMATCH
  reason_message        VARCHAR,
  device_id             VARCHAR,
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  distance_meters       DOUBLE PRECISION,
  confidence_score      INTEGER,          -- nullable; soft-failure review score only
  review_status         VARCHAR NOT NULL, -- 'pending' | 'accepted' | 'rejected' | 'resolved' | 'not_required'
  reviewed_at           TIMESTAMP,
  reviewed_by_professor_id INTEGER REFERENCES professors(id),
  created_at            TIMESTAMP DEFAULT NOW()
  -- deliberately no uniqueness constraint: every retry is retained
);

-- notifications
notifications (
  id            SERIAL PRIMARY KEY,
  student_id    INTEGER REFERENCES students(id),
  title         VARCHAR,
  message       VARCHAR,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- attendance_warnings
attendance_warnings (
  id                    SERIAL PRIMARY KEY,
  student_id            INTEGER REFERENCES students(id),
  course_id             INTEGER REFERENCES courses(id),  -- ★ NEW: warnings are per-course
  absence_count         INTEGER NOT NULL,
  attendance_percentage NUMERIC,
  status                VARCHAR   -- 'excellent' | 'safe' | 'warning' | 'critical'
);
```

Warning tiers (computed, not stored redundantly elsewhere):
- 0–3 absences → Excellent
- 4–5 absences → Safe
- 6–7 absences → Warning (notification created)
- 8+ absences → Critical (notification created and included in professor defaulter reports)

Absences are calculated per enrolled course-section as total ended sessions
minus sessions where the student was marked present. Attendance percentage is
retained for display and context, but does not determine the warning tier.

---

## 6. Auth Flow

1. **No public signup.** Accounts (student/professor/admin) are created
   only via the Admin panel (§14) or the demo seed script — never via a
   general-purpose sign-up screen on mobile.
2. Password hashed with bcrypt before storage — never store plaintext.
3. Login → verify email + password → issue JWT containing `{ user_id, role }`.
4. Every protected route: middleware verifies JWT, then checks role matches
   what the route requires.
5. Frontend routes to Student/Professor/Admin dashboard based on role in
   the decoded token, and persists the session via secure storage so the
   app remembers login across restarts.
6. `POST /auth/signup` still exists as a backend route — it's just never
   called from a public mobile screen. Only the Admin panel calls it.
7. Logout is local-first: the app clears its Zustand session and attempts
   SecureStore deletion without waiting for a server response. Any
   authenticated API response with HTTP 401 performs the same local clear and
   routes the user to sign-in, including after token expiry or JWT-secret
   rotation.

---

## 7. Device Registration (Proxy Prevention Layer 1)

- A student's `device_id` is `NULL` until their first successful login from
  the mobile app.
- On first login, the app generates/reads a stable device identifier and
  sends it to the backend; backend stores it on the `students` row.
- Device binding is attempted only in that first successful mobile sign-in.
  Restoring a saved session and opening the scanner never binds or replaces a
  device. The backend uses an atomic NULL-only update, so concurrent first
  logins cannot overwrite an existing binding.
- On later logins and every scan, the stored value is compare-only. A scan
  from a different device is rejected as `DEVICE_MISMATCH` and appears in the
  professor's reviewable flagged-attempts list; it never re-binds the account.
- "Change device" is a future/admin-assisted flow — not built in MVP.

---

## 8. QR Architecture (Proxy Prevention Layer 2)

QR payload (JSON, encoded into the QR image) contains:
```json
{
  "session_id": 123,
  "token": "<signed JWT, short expiry>",
  "course_id": 45,
  "section": "287",
  "issued_at": 1721559600
}
```

- Backend regenerates `qr_token` for the active session **every 10 seconds**
  and pushes the new QR to the professor's screen via Socket.io (not polling).
- The immediately previous token is retained only for a **3-second grace
  period** after rotation. This tolerates a valid scan that reaches the server
  at the rotation boundary; tokens from two or more rotations ago are always
  rejected. The grace period is deliberately shorter than the 10-second
  rotation interval to preserve screenshot resistance.
- Token is signed (JWT) so it can't be forged client-side.
- Attendance sessions default to **10 minutes** and automatically end at their
  session expiry if the professor does not end them first. This is independent
  of the 10-second QR rotation interval.

---

## 9. Attendance Validation Pipeline (Proxy Prevention Layer 3 — the core logic)

Executed server-side on every scan (`POST /attendance/scan`). Hard gates remain
**fail-fast**: an invalid or undecodable QR (including a bad signature), an
enrollment/section boundary rejection, and duplicate confirmed attendance reject
immediately, are audit-only, and never receive a score or professor flag. A
signed, decodable QR that merely expired or rotated out is not malformed: it can
still identify its session and is evaluated as a soft QR-timing signal. The
enrollment rule requires a
`course_students` row matching **both** the session's `course_id` and `section`.

Once a signed QR identifies a known session and the student is enrolled in that
exact course-section, all three soft checks are evaluated together, even if one
has failed:

1. **QR timing** — current token scores 100; the immediately previous token is
   accepted inside the 3-second grace period and scores 70; any older signed,
   session-identifying token is stale, scores 20, and remains a reviewable soft
   failure rather than a malformed-token rejection.
2. **Registered device** — incoming `device_id` matches the stored device.
3. **Within geofence** — Haversine distance is at or below the session radius.

Any soft failure still rejects the scan, but all failed soft checks are retained
on the same audit row. The student receives the existing full explanations for
the failed checks. The professor sees only concise headings: `Device mismatch`,
`Stale QR token`, and `Out of range by Xm`, plus a confidence score.

For a failed soft attempt, `scan_attempts.confidence_score` is:

```
deviceSubScore: 100 when matched, otherwise 0
geofenceSubScore: 100 within radius; otherwise max(0, 100 - 2 * metersOverRadius)
qrTimingSubScore: 100 for current token, 70 for grace-period token, 20 for a stale signed token

confidenceScore = max(5, round(
  deviceSubScore * 0.50 + geofenceSubScore * 0.35 + qrTimingSubScore * 0.15
))
```

Clean passes do not store a confidence score. After the hard gates and all soft
checks pass, the server writes a successful `scan_attempts` row, inserts an
`attendance` row with `status = 'present'`, and pushes a live update via
Socket.io.

Every request writes exactly one `scan_attempts` audit row. A failed check
writes `result = 'failed'`, its distinct reason code/message, and useful scan
metadata, but never writes to `attendance`. The student may correct the issue
and retry; each retry is another audit row. Only a fully successful validation
creates confirmed attendance. The professor's Flagged counter is the number of
distinct students with failed, still-pending `scan_attempts` for that session,
matching the consolidated review list.

Only technical, potentially overrideable soft failures appear in Flagged review:
for example geofence, device, or QR-timing problems. **A failure is
flag-worthy only when the student is enrolled in that session's exact
course-section.** Enrollment is checked before soft scoring, so a non-enrolled
student is rejected at that hard boundary; their attempt is audit-only and is
not shown to the professor. Boundary rejections (`NOT_ENROLLED`,
`SECTION_MISMATCH`, and duplicate attendance) likewise remain in
`scan_attempts` for audit, but never appear in the professor's Flagged list or
counter and cannot be manually accepted.

The mobile scanner is single-fire: it locks synchronously on the first QR
detection before starting network work. Camera callbacks remain disabled while
the request is pending and after success. A failure can only re-enable scanning
when the student explicitly taps **Scan again**.

A duplicate scan after confirmed attendance is an expected no-op: the student
receives an "already verified" success response and is returned Home. It may be
retained as an audit-only `scan_attempt`, but it is never a failed attempt and
is excluded from Flagged counters and professor review lists.

Scan success UI is local to one visit to the scanner and one `session_id`.
Leaving the scanner clears that presentation state; reopening it for a later
session always starts ready for a fresh scan. Confirmed attendance itself is
scoped only by the database key `(session_id, student_id)`.

When a student later passes validation and receives confirmed attendance, all
earlier pending, reviewable technical failures for that same `(session_id,
student_id)` are marked `resolved`. Their audit rows remain in
`scan_attempts`, but they are removed from the live and historical Flagged
review list because the student has since been confirmed present. If no valid
attendance row is created and the professor has not rejected the failure, it
remains reviewable after the session ends. Boundary rejections are never made reviewable and are not
resolved through this flow.

### 9A. Professor Manual Attendance Review and Overrides

During an active session, the professor can expand the Flagged counter to see
one consolidated row per student/session. It shows the student's name,
university student ID, most recent rejection reason and timestamp, plus the
number of pending attempts. Every underlying attempt remains separately stored
in `scan_attempts`; consolidation is presentation-only. Accept or Reject marks
all pending attempts represented by that consolidated row as reviewed.

- **Accept** marks the attempt reviewed/accepted and creates confirmed
  attendance with `manual_override = TRUE`. The normal attendance uniqueness
  constraint still prevents two confirmed marks for one student/session.
- **Reject** marks the attempt reviewed/rejected and creates no attendance.
  The enrolled student immediately returns to **Pending**: they can retry an
  active session or be manually marked present later. If the session ends
  without confirmed attendance, they are counted absent normally.
- **Present** lists all confirmed students. **Mark Absent** removes that
  student's attendance row and records an audit-only manual override. The
  student returns to Pending, whether the session is active or ended.
- Both actions are restricted to the professor who owns the session and push
  refreshed counters over that session's Socket.io room.
- Accepted and rejected attempts remain in `scan_attempts` as a permanent
  audit record; they are no longer included in the pending Flagged counter.

Pending students are a separate category: enrolled students with neither a
confirmed attendance row nor an unresolved reviewable failure for that session.
Rejected, resolved, and audit-only attempts do not remove a student from
Pending. The professor can open Pending during an active session or from an
ended session in Reports and choose **Mark Present**. This bypasses automated scan validation, creates
`attendance.status = 'present'` with `manual_override = TRUE`, and updates live
counters when the session is active. Pending and Flagged lists always show the
student's name and university `student_id`, never internal IDs.

All mobile dates and timestamps are rendered using the Gregorian calendar,
explicitly independent of the device's system calendar preference.

---

## 10. Geofencing

- Frontend: `Expo Location` starts acquiring a location fix as soon as the
  scan screen opens, before the camera accepts scans. The scan request uses
  that cached recent fix immediately rather than waiting for a new GPS request
  after QR decode.
- When a professor starts a session, the professor app captures the device's
  current location and sends it to `POST /attendance/start`; session geofence
  coordinates must never be hardcoded.
- Backend: Haversine formula computes distance between student's coords and
  the session's stored classroom coords.
- Recommended radius: 30–50 meters (configurable per session at start time,
  default 40m).
- GPS is one layer among several — not solely relied upon.

---

## 11. Real-Time Updates (Socket.io)

Events pushed to the **professor's** connected client during an active session:
- New QR token (every 10s)
- Present counter increment
- Pending counter (enrolled with no attendance and no scan attempt)
- Pending flagged-student counter sourced from failed `scan_attempts`
- Reviewable flagged-attempt list with professor Accept/Reject actions
- Live list of students who've checked in
- Remaining session time (countdown)

Room/channel convention: one Socket.io room per `session_id`.

---

## 12. Warning System

Computed **per student, per course** (aggregating across that student's one
enrolled section of that course):
- 0–3 absences → Excellent
- 4–5 absences → Safe
- 6–7 absences → Warning (student gets a notification)
- 8+ absences → Critical (student gets a notification, flagged in professor's
  defaulter report)

Absences are calculated using **ended sessions only**: total ended sessions in
the student's enrolled course-section minus ended sessions where the student
was marked present. An active session never changes absence counts, warning
tiers, attendance percentages, or defaulter reports. Once it ends, students
without confirmed attendance count absent. The attendance percentage remains
available for context, but does not determine the warning tier.

---

## 13. API Routes

```
Auth
  POST   /auth/signup             -- backend-only; called exclusively by the Admin panel
  POST   /auth/login

Students
  GET    /students/profile
  GET    /students/courses        -- returns course + the student's enrolled section for each
  GET    /students/attendance
  PATCH  /students/device         -- device binding (first login only)
  PATCH  /students/profile/password

Professors / Attendance Sessions
  POST   /attendance/start          -- requires course_id AND section; creates session, begins QR rotation
  POST   /attendance/end            -- closes session
  GET    /attendance/reports        -- 5-row session pages with sort/date/section filters + watchlist
  GET    /attendance/reports/analytics -- aggregate metrics per taught course-section
  GET    /attendance/reports/export -- scoped CSV for one/all taught course-sections
  GET    /attendance/sessions/:id   -- professor-owned session detail and counters
  GET    /attendance/sessions/:id/pending-students
  GET    /attendance/sessions/:id/present-students
  POST   /attendance/sessions/:id/students/:studentId/mark-present
  POST   /attendance/sessions/:id/students/:studentId/mark-absent
  GET    /attendance/sessions/:id/flagged-attempts

Attendance (scan-side)
  POST   /attendance/scan           -- runs the full validation pipeline (§9)
  GET    /attendance/history
  GET    /attendance/live           -- fallback REST snapshot (Socket.io is primary)

Courses
  GET    /courses

Admin (the only account-creation surface in the app)
  GET    /admin/statistics
  GET    /admin/catalog                 -- courses/sections plus assignable professors/students
  POST   /admin/create-course           -- includes creating sections
  PATCH  /admin/courses/:id             -- edit course fields and add persistent sections
  POST   /admin/create-user             -- professor or student account
  POST   /admin/assign-professor        -- course_professors, course_id + professor_id + section
  POST   /admin/enroll-student          -- course_students, course_id + student_id + section
```

All routes except `/auth/login` require a valid JWT. Role-specific routes
additionally check `role` from the token. `/auth/signup` requires an admin
JWT — it is not publicly reachable without one.

---

## 14. Docker Setup

Two services in `docker-compose.yml` (frontend runs natively via Expo, not containerized):
1. `postgres` — Postgres 16, persistent volume, exposes 5432
2. `api` — Node/Express API (built via `apps/api/Dockerfile`), exposes 3000,
   depends on postgres being healthy first

### Local environment and baseline API protections

- Copy root `.env.example` to root `.env` before running Docker Compose. It
  must define a strong local `POSTGRES_PASSWORD` and `JWT_SECRET`; `.env` is
  gitignored and must never be committed. Docker Compose injects both values
  into Postgres and the API's `DATABASE_URL`.
- `apps/api/.env.example` documents the matching variables needed only when
  running the API directly outside Docker.
- `TRUST_PROXY` stays `false` for direct local Docker access. Set it to `1`
  only behind one known hosting reverse proxy that supplies
  `X-Forwarded-For`; this lets Express use the real client IP without trusting
  spoofable forwarding headers on direct connections.
- The API uses Helmet's standard security headers.
- Rate limits are enforced in-process: login is 10 attempts per normalized
  attempted email and client IP per 15 minutes; authenticated signup is 10
  attempts per admin account per 15 minutes; attendance scans are 15 attempts
  per authenticated student per 2 minutes. The combined login key prevents
  one student on a shared hotspot from locking out another account. A limit
  returns HTTP 429 with a generic retry-later message.

---

## 15. Build Order (as actually built, not the original week-based estimate)

1. Repo scaffold
2. Database schema + Docker
3. Auth (login only, JWT/bcrypt)
4. Mobile navigation skeleton + design tokens
5. Auth wired to mobile (sign-in → routing by role, session persistence) — *this doc sync + signup removal also happens here*
6. Student Home
7. Student Courses & Profile
8. Professor Home (session start, section-aware)
9. QR rotation + Socket.io
10. Attendance scan + full section-aware validation pipeline
11. Device registration
12. Professor Reports
13. Warning system & notifications
14. Admin panel (account + section provisioning)
15. Polish
16. Demo prep & near-deployment

---

## 16. Competition Demo Script

1. Professor logs in, starts a session for one specific course-section they teach.
2. QR appears, visibly rotates on a countdown.
3. Student scans → attendance succeeds, dashboard updates live.
4. **Deliberately show a failed scan** — ideally a **section mismatch**
   (a real student enrolled in a *different* section of the same course
   tries to scan in) alongside an expired-token or out-of-range-GPS
   example — to prove the validation pipeline actually rejects fraud AND
   correctly distinguishes "wrong section" from other rejection types.
5. End session, pull up the report / defaulter list.

---

## 17. Explicit Non-Goals for MVP

- ML/predictive defaulter detection (current system is threshold-based only)
- BLE cross-verification, Wi-Fi heatmaps, accelerometer "ghost scan" checks
- Voice check-in / accessibility alt-flow
- Facial verification
- LMS/SSO integration
- Self-service device-change flow
- Public self-registration (accounts are always admin/seed-provisioned)

---

## 18. Final Architecture (data flow)

```
Student   → React Native app → Express API → PostgreSQL
Professor → React Native app → Socket.io ↔ Express API → PostgreSQL

Attendance Session lifecycle:
  Professor selects course + SECTION → Start
    → Dynamic QR rotation (10s)
    → Student scan
    → Validation Pipeline (7 checks, incl. course+section match)
    → Postgres write
    → Socket.io broadcast
    → Professor live dashboard
    → End session → Reports/Analytics
```
