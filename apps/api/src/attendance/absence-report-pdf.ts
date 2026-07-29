import { readFile } from "node:fs/promises";

import puppeteer from "puppeteer";

export interface AbsenceReportStudent {
  studentId: string;
  name: string;
  department: string | null;
  absenceCount: number;
  attendancePercentage: number;
}

export interface AbsenceReportInput {
  courseCode: string;
  courseName: string;
  section: string;
  semester: number | null;
  generatedAt: Date;
  students: AbsenceReportStudent[];
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatGregorianDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Riyadh"
  }).format(date);
}

function warningLabel(absenceCount: number): string {
  if (absenceCount >= 10) return "محروم";
  if (absenceCount >= 7) return "تحذير";
  return "-";
}

function daysRemaining(absenceCount: number): string | number {
  return absenceCount >= 7 ? "-" : Math.max(0, 10 - absenceCount);
}

async function logoDataUri(): Promise<string> {
  const logo = await readFile(new URL("../../assets/al-yamamah-university-logo.png", import.meta.url));
  return `data:image/png;base64,${logo.toString("base64")}`;
}

function buildDocument(input: AbsenceReportInput, logo: string): string {
  const rows = input.students.map((student, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(student.studentId)}</td>
      <td class="student-name">${escapeHtml(student.name)}</td>
      <td>منتظم</td>
      <td>${daysRemaining(student.absenceCount)}</td>
      <td>${student.absenceCount}</td>
      <td>${student.attendancePercentage}%</td>
      <td class="${student.absenceCount >= 10 ? "denial" : student.absenceCount >= 7 ? "warning" : ""}">${warningLabel(student.absenceCount)}</td>
      <td>${escapeHtml(student.department ?? "-")}</td>
    </tr>`).join("");

  const term = input.semester === null ? "-" : `الفصل الدراسي ${input.semester}`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4 portrait; margin: 13mm 11mm 15mm; }
      * { box-sizing: border-box; }
      body { color: #151515; font-family: "Noto Naskh Arabic", "Noto Sans Arabic", Arial, sans-serif; font-size: 11px; margin: 0; }
      .top-prayer { font-size: 15px; font-weight: 700; margin-bottom: 5px; text-align: center; }
      .brand { align-items: center; border-bottom: 3px solid #f58231; display: flex; justify-content: space-between; padding: 0 2px 6px; }
      .brand img { height: 70px; object-fit: contain; width: 70px; }
      .brand-title { flex: 1; line-height: 1.25; padding: 0 16px; text-align: center; }
      .brand-title .arabic { font-size: 20px; font-weight: 700; }
      .brand-title .english { direction: ltr; font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; margin-top: 2px; }
      .page-meta { direction: ltr; font-family: Arial, sans-serif; font-size: 9px; line-height: 1.55; min-width: 80px; text-align: right; }
      .report-title { border-bottom: 1px solid #f58231; font-size: 19px; font-weight: 700; margin: 11px 0 8px; padding-bottom: 5px; text-align: center; }
      .info { border: 1px solid #f58231; display: grid; gap: 0; grid-template-columns: repeat(3, 1fr); margin-bottom: 10px; }
      .info-item { border-left: 1px solid #f58231; min-height: 34px; padding: 5px 7px; }
      .info-item:last-child { border-left: 0; }
      .info-label { color: #d96516; font-weight: 700; }
      .info-value { display: inline; font-weight: 700; margin-right: 4px; }
      table { border-collapse: collapse; table-layout: fixed; width: 100%; }
      thead { display: table-header-group; }
      th { background: #f58231; border: 1px solid #c95c13; color: #111; font-size: 10px; font-weight: 700; line-height: 1.25; padding: 6px 3px; vertical-align: middle; }
      td { border: 1px solid #d9d9d9; overflow-wrap: anywhere; padding: 5px 3px; text-align: center; vertical-align: middle; }
      tbody tr:nth-child(even) { background: #fff9f5; }
      .student-name { text-align: right; }
      .warning { color: #9a6200; font-weight: 700; }
      .denial { color: #b11f15; font-weight: 700; }
      th:nth-child(1) { width: 4%; } th:nth-child(2) { width: 12%; } th:nth-child(3) { width: 18%; }
      th:nth-child(4) { width: 11%; } th:nth-child(5) { width: 12%; } th:nth-child(6) { width: 9%; }
      th:nth-child(7) { width: 8%; } th:nth-child(8) { width: 9%; } th:nth-child(9) { width: 17%; }
      .footer { border-top: 1px solid #f58231; color: #555; font-size: 9px; margin-top: 10px; padding-top: 4px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="top-prayer">بسم الله الرحمن الرحيم</div>
    <header class="brand">
      <div class="page-meta">Date: ${formatGregorianDate(input.generatedAt)}<br />Page 1 of 1</div>
      <div class="brand-title"><div class="arabic">جامعة اليمامة</div><div class="english">Al Yamamah University</div></div>
      <img src="${logo}" alt="Al Yamamah University" />
    </header>
    <div class="report-title">متابعة الغياب</div>
    <section class="info">
      <div class="info-item"><span class="info-label">الفصل:</span><span class="info-value">${escapeHtml(term)}</span></div>
      <div class="info-item"><span class="info-label">رقم الشعبة:</span><span class="info-value">${escapeHtml(input.section)}</span></div>
      <div class="info-item"><span class="info-label">المقرر:</span><span class="info-value">${escapeHtml(`${input.courseCode} - ${input.courseName}`)}</span></div>
      <div class="info-item"><span class="info-label">النشاط:</span><span class="info-value">نظري</span></div>
    </section>
    <table>
      <thead><tr>
        <th>م</th><th>الرقم الجامعي</th><th>اسم الطالب</th><th>حالة المقرر</th>
        <th>الأيام المتبقية حتى الحرمان</th><th>أيام الغياب</th><th>النسبة</th><th>التنبيه</th><th>التخصص</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Al Yamamah University · Absence Follow-up</div>
  </body>
</html>`;
}

export async function createAbsenceReportPdf(input: AbsenceReportInput): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setContent(buildDocument(input, await logoDataUri()), { waitUntil: "domcontentloaded" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await browser.close();
  }
}
