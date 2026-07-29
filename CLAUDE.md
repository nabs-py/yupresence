# Project rules for yupresence

Read /docs/architecture.md before starting any phase. That document is the
source of truth for schema, API routes, the validation pipeline order, and
feature scope. If this file and that file ever conflict, ask me — don't guess.

## Stack — do not change without asking me first
- Mobile: React Native via Expo sdk version 54 strictly (Expo Router), NativeWind for styling
- Backend: Node.js + Express + TypeScript
- ORM: Prisma, Database: PostgreSQL running in Docker
- Auth: custom JWT + bcrypt (NOT a third-party auth provider — this is a
  deliberate choice for a competition demo, do not suggest swapping to
  Clerk/Auth0/Firebase Auth)
- Realtime: Socket.io (client + server)
- QR: a signed-JWT-token payload rendered via a QR generation library
  (e.g. `react-native-qrcode-svg` on the professor's screen), scanned via
  `expo-camera`
- Location: `expo-location`
- State/data fetching: TanStack Query on the client; Zustand only for local
  UI state (modal open/closed, sort mode, active tab)

## Design system — Apple-inspired, non-negotiable across every screen
- Palette: black, white, and a small set of greys only. No accent colors
  except for status states (e.g. red for "Critical / DN" warning, done sparingly).
- Typography: use "Inter" (via `expo-font`) as the base font, NOT the RN
  default system font — set this up once in Phase 5 and reference it
  everywhere. Headlines are large and bold (Apple Health/Fitness style —
  think a 48px+ number for the attendance %, not a 16px stat buried in a row).
- Generous whitespace/padding — err on the side of more spacing, not less.
- Fully rounded corners on cards and buttons (pill-shaped buttons, ~20-24px
  card radius). Keep this in `constants/theme.ts`, never hardcode a radius
  or hex color directly in a component.
- Maximum 3 primary pages per role (Student: Home/Courses/Profile.
  Professor: Home/Reports/Profile). Admin is exempt from this limit — it's
  an internal ops tool and can use denser table/list layouts.
- Every screen should have one obvious primary number or one obvious
  primary action. If a screen needs a second heading to organize itself,
  that's a signal it should be a drill-in state of an existing page, not a
  new tab — flag this to me rather than silently adding a new page.

## Hard rules
1. Never introduce a new major dependency (different ORM, different nav
   library, a third-party auth provider, a different realtime library)
   without stopping and asking me first.
2. Never touch `docker-compose.yml` or the Prisma schema's existing fields
   without explaining the change and why, before writing it.
3. Every API route must be scoped to the authenticated user's role and
   identity — e.g. a student can only ever fetch their own attendance/profile,
   a professor can only start/end sessions and pull reports for courses they
   teach. No route should ever return another user's data. Flag this
   explicitly in each phase summary.
4. The attendance validation pipeline order is fixed (see /docs/architecture.md
   §9): token valid → token current → device match → enrollment → geofence →
   duplicate check → mark present. Never reorder, skip, or short-circuit these
   checks without asking me first, even for "just testing" convenience —
   if you need a dev bypass, make it an explicit env-flagged dev-only path
   that's obviously labeled, never a silent change to the real pipeline.
5. `device_id` binding is permanent once set in MVP — no self-service device
   change flow. Don't build one even if it seems like an obvious missing
   feature; it's an intentional scope cut.
6. TypeScript strict mode stays on. No `any` unless you leave a
   `// TODO: type this` comment explaining why.
7. Passwords are always bcrypt-hashed before storage — never log, return,
   or store plaintext passwords, not even in dev/debug output.
8. Every new screen/component must be responsive across small and large iOS
   devices (iPhone SE through iPhone Pro Max, including notches, Dynamic
   Island, and home indicators) and Android phones with different aspect
   ratios, punch-hole/status-bar areas, and gesture navigation. Use
   `react-native-safe-area-context` for reachable safe-area layout, avoid
   fixed pixel layout dimensions where flex/percentages/window dimensions are
   appropriate, and ensure every tappable element has a minimum 44pt iOS / 48dp
   Android target (visual size may be smaller only when padding or hitSlop
   preserves that target).
9. After each phase, tell me: what was added, what files changed, and any
   manual step I need to do myself (e.g. `npx prisma migrate dev`, env vars
   to set, Expo permissions to configure).
10. Don't invent UI or features not in the architecture doc without flagging
    it as a suggestion first — ask, then build.
11. Write small, focused commits per logical change, not one giant commit
    per phase.
12. If something in the plan is ambiguous or you have to guess, state the
    assumption out loud before writing code.

## Definition of done for any phase
- Code compiles / app boots with no red screen errors
- No hardcoded secrets — everything sensitive goes through `.env` (and is
  listed in `.env.example`)
- Loading and error states exist for anything that fetches data
- Safe areas, responsive layout at small/large iOS and Android sizes, minimum
  touch targets, and long-text overflow behavior have been checked for every
  new or changed screen
- Any route touching attendance/session logic has been checked against the
  validation pipeline order in the architecture doc
- You've told me exactly what to run/check to verify it works
