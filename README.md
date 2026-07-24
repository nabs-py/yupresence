# Yupresence

## Demo Database Seed

Start the database and API, then run the idempotent seed inside the API container:

```bash
docker compose up -d
docker compose exec api npx prisma migrate deploy
docker compose exec api npx prisma db seed
```

The seed wipes and recreates linked courses, section-specific enrollments, section-specific teaching assignments, twenty-five past sessions, attendance history, and warning rows. It uses the fixed demo accounts below and does not generate random passwords.

### Demo credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@demo.yupresence.local` | `AdminDemo!2026` |
| Professor | `professor.alice@demo.yupresence.local` | `ProfessorAlice!2026` |
| Professor | `professor.bilal@demo.yupresence.local` | `ProfessorBilal!2026` |
| Professor | `professor.charlie@demo.yupresence.local` | `ProfessorCharlie!2026` |
| Student | `student.aisha@demo.yupresence.local` | `StudentAisha!2026` |
| Student | `student.diddy@demo.yupresence.local` | `StudentDiddy!2026` |
| Student | `student.maya@demo.yupresence.local` | `StudentMaya!2026` |
| Student | `student.omar@demo.yupresence.local` | `StudentOmar!2026` |
| Student | `student.sara@demo.yupresence.local` | `StudentSara!2026` |
| Student | `student.yusuf@demo.yupresence.local` | `StudentYusuf!2026` |

## Authentication API

Start the API and send JSON requests to `http://localhost:3000`.

### Student signup

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Aisha Khan","email":"aisha@example.com","password":"secure-password","role":"student","student_id":"2026001","department":"Computer Science","semester":6}'
```

### Professor signup

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Omar Ali","email":"omar@example.com","password":"secure-password","role":"professor","employee_id":"EMP-101","department":"Computer Science"}'
```

### Admin signup

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sara Noor","email":"sara@example.com","password":"secure-password","role":"admin","admin_code":"ADMIN-001"}'
```

### Student login

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"aisha@example.com","password":"secure-password"}'
```

### Professor login

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"omar@example.com","password":"secure-password"}'
```

### Admin login

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sara@example.com","password":"secure-password"}'
```

Every successful login returns a JWT whose payload includes `user_id` and `role`.

### Prisma Studio in Docker

The API container publishes Prisma Studio on port `5555`:

```bash
docker compose exec api npx prisma studio --hostname 0.0.0.0 --port 5555 --browser none
```

Open `http://localhost:5555` while that command is running.

## Professor Web Display

The read-only projector display runs as a separate Vite server. Start the API
and display in two terminals:

```bash
docker compose up -d --build
npm run dev:web-display
```

Open `http://localhost:5173` and log in with the same professor account used
on the phone. The page keeps its JWT in memory only, polls for that professor's
active session, then receives QR rotations, counters, and remaining time over
Socket.io. Ending the session from the phone returns the page to its waiting
state automatically.

No environment variable is required when the API is at
`http://localhost:3000`. If the display is running on another laptop, create
`apps/web-display/.env.local` with the API machine's LAN address:

```bash
VITE_API_URL=http://192.168.x.x:3000
```

When opening the Vite server through a LAN URL rather than `localhost`, add
that exact origin (for example `http://192.168.x.x:5173`) to the API's
`CORS_ORIGINS` value in `docker-compose.yml` before rebuilding the API.
