import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { authRouter } from "./auth/routes.js";
import { attendanceRouter } from "./attendance/routes.js";
import { adminRouter } from "./admin/routes.js";
import { configureAttendanceRealtime, resumeActiveSessionsRealtime } from "./attendance/realtime.js";
import { studentsRouter } from "./students/routes.js";
import { professorsRouter } from "./professors/routes.js";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:8081,http://localhost:8082,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/attendance", attendanceRouter);
app.use("/students", studentsRouter);
app.use("/professors", professorsRouter);
app.use("/admin", adminRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});
configureAttendanceRealtime(io);

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  void resumeActiveSessionsRealtime().catch((error) => console.error("Unable to resume active attendance sessions", error));
});
