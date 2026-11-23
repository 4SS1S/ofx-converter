import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error -- no types for the worker bundle
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;

const APP_TEMP_ROOT = "/tmp/ofx-converter";
const UPLOADS_DIR = path.join(APP_TEMP_ROOT, "uploads");
const ERROR_LOG_PATH = path.join(APP_TEMP_ROOT, "error-history.log");

let cleanupTimerStarted = false;

interface Transaction {
  date: string;        // YYYYMMDD
  amount: number;      // positive = credit, negative = debit
  description: string;
  id: string;
}

export async function logError(entry: Record<string, unknown>) {
  await fs.mkdir(APP_TEMP_ROOT, { recursive: true });
  const record = { timestamp: new Date().toISOString(), ...entry };
  await fs.appendFile(ERROR_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readErrorHistory(limit = 10) {
  try {
    const content = await fs.readFile(ERROR_LOG_PATH, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return { message: line };
        }
      });
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export async function ensureTempFolders() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export function startDailyCleanup() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  void cleanupOldFiles();
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) void cleanupOldFiles();
  }, 60_000);
}

export async function cleanupOldFiles() {
  await ensureTempFolders();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(UPLOADS_DIR, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.mtimeMs < cutoff) await fs.unlink(fullPath);
    } catch {
      // Ignore cleanup failures for files that are already gone.
    }
  }
}

export async function convertUploadedFile(fileName: string, buffer: Buffer) {
  await ensureTempFolders();

  if (!buffer || buffer.length === 0) {
    throw new Error("Arquivo vazio ou inválido.");
  }

  const safeBaseName = sanitizeFileName(fileName);
  const sourcePath = path.join(UPLOADS_DIR, `${randomUUID()}-${safeBaseName}`);
  await fs.writeFile(sourcePath, buffer);

  let extractedText = "";

  try {
    extractedText = await extractTextFromBuffer(buffer, fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao extrair conteúdo do arquivo.";
    await logError({ type: "conversion", fileName, message, size: buffer.length });
    throw new Error(`Arquivo inválido para conversão: ${message}`);
  } finally {
    await fs.unlink(sourcePath).catch(() => undefined);
  }

  const period = extractPeriodFromFileName(fileName);
  const transactions = extractTransactionsFromText(extractedText);
  const today = new Date().toISOString().replace(/[-:]/g, "").slice(0, 8);

  let dtStart: string;
  let dtEnd: string;

  if (period) {
    dtStart = period.dtStart;
    dtEnd = period.dtEnd;
  } else if (transactions.length > 0) {
    const dates = transactions.map((t) => t.date).sort();
    dtStart = dates[0];
    dtEnd = dates[dates.length - 1];
  } else {
    dtStart = today;
    dtEnd = today;
  }

  const serverDate = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
  const ofxContent = buildOfxDocument(safeBaseName, transactions, dtStart, dtEnd, serverDate);

  return {
    ofxContent,
    fileName: `${safeBaseName}.ofx`,
  };
}

// --- Parsing helpers ---

function parseDateBR(value: string): string | null {
  const m = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  return m ? `${m[3]}${m[2]}${m[1]}` : null;
}

function parseBrAmount(value: string): number | null {
  const cleaned = value.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractPeriodFromFileName(fileName: string): { dtStart: string; dtEnd: string } | null {
  const m = fileName.match(/(\d{2}[-\/]\d{2}[-\/]\d{4}).*?(\d{2}[-\/]\d{2}[-\/]\d{4})/);
  if (!m) return null;
  const dtStart = parseDateBR(m[1].replace(/\//g, "-"));
  const dtEnd = parseDateBR(m[2].replace(/\//g, "-"));
  if (!dtStart || !dtEnd) return null;
  return { dtStart, dtEnd };
}

function extractTransactionsFromText(text: string): Transaction[] {
  const transactions: Transaction[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const dateMatch = trimmed.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
    if (!dateMatch) continue;

    const date = parseDateBR(dateMatch[1]);
    if (!date) continue;

    // Find all amounts in Brazilian format (e.g. 1.234,56 or -1.234,56)
    const amountMatches = [...trimmed.matchAll(/-?[\d.]+,\d{2}/g)];
    if (amountMatches.length === 0) continue;

    // First amount is the transaction value; last (if different) is often the running balance
    const amount = parseBrAmount(amountMatches[0][0]);
    if (amount === null || amount === 0) continue;

    // Description: text between the date and the first amount
    const dateIdx = dateMatch.index! + dateMatch[0].length;
    const amtIdx = amountMatches[0].index!;
    const description = trimmed
      .slice(dateIdx, amtIdx)
      .replace(/R\$\s*/g, "")
      .replace(/[-–]\s*$/, "")
      .trim() || "Transação";

    transactions.push({
      date,
      amount,
      description,
      id: createHash("sha1")
        .update(`${date}${amount}${description}${transactions.length}`)
        .digest("hex")
        .slice(0, 16),
    });
  }

  return transactions;
}

// --- Text extraction ---

function sanitizeFileName(fileName: string) {
  const parsed = path.parse(fileName || "document");
  const baseName = (parsed.name || "document")
    .replace(/[^a-zA-Z0-9-_]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return baseName || "document";
}

async function extractTextFromBuffer(buffer: Buffer, fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return extractPdfText(buffer);
  if (extension === ".docx") return extractDocxText(buffer);
  if (extension === ".txt") return buffer.toString("utf8");
  return buffer.toString("utf8", 0, Math.min(buffer.length, 20_000));
}

async function extractPdfText(buffer: Buffer) {
  try {
    const data = new Uint8Array(buffer);
    const doc = await getDocument({ data, useWorkerFetch: false, useSystemFonts: true }).promise;
    const pageTexts: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      // Group text items by Y coordinate to reconstruct visual lines
      const lineMap = new Map<number, Array<{ x: number; text: string }>>();

      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = (item as { transform: number[] }).transform;
        const y = Math.round(transform[5]);
        const x = transform[4];
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y)!.push({ x, text: item.str });
      }

      // Sort lines top-to-bottom (Y descending in PDF coords), items left-to-right
      const lines = [...lineMap.entries()]
        .sort(([a], [b]) => b - a)
        .map(([, items]) =>
          items
            .sort((a, b) => a.x - b.x)
            .map((i) => i.text)
            .join(" "),
        );

      pageTexts.push(lines.join("\n"));
    }

    return pageTexts.join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ler PDF.";
    throw new Error(`PDF inválido ou corrompido: ${message}`);
  }
}

async function extractDocxText(buffer: Buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: buffer as Buffer });
    return result.value || "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ler DOCX.";
    throw new Error(`DOCX inválido ou corrompido: ${message}`);
  }
}

// --- OFX builder ---

function buildOfxDocument(
  fileName: string,
  transactions: Transaction[],
  dtStart: string,
  dtEnd: string,
  serverDate: string,
): string {
  const fallbackId = createHash("sha1")
    .update(`${fileName}${serverDate}`)
    .digest("hex")
    .slice(0, 16);

  const trnEntries =
    transactions.length > 0
      ? transactions
          .map(
            (t) => `      <STMTTRN>
        <TRNTYPE>${t.amount >= 0 ? "CREDIT" : "DEBIT"}</TRNTYPE>
        <DTPOSTED>${t.date}</DTPOSTED>
        <TRNAMT>${t.amount.toFixed(2)}</TRNAMT>
        <FITID>${t.id}</FITID>
        <MEMO>${escapeXml(t.description.slice(0, 255))}</MEMO>
      </STMTTRN>`,
          )
          .join("\n")
      : `      <STMTTRN>
        <TRNTYPE>DEBIT</TRNTYPE>
        <DTPOSTED>${dtStart}</DTPOSTED>
        <TRNAMT>0.00</TRNAMT>
        <FITID>${fallbackId}</FITID>
        <MEMO>${escapeXml(fileName)}</MEMO>
      </STMTTRN>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <DTSERVER>${serverDate}</DTSERVER>
      <LANGUAGE>POR</LANGUAGE>
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1001</TRNUID>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <STMTRS>
        <CURDEF>BRL</CURDEF>
        <BANKACCTFROM>
          <BANKID>077</BANKID>
          <ACCTID>${escapeXml(fileName).slice(0, 22)}</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${dtStart}</DTSTART>
          <DTEND>${dtEnd}</DTEND>
${trnEntries}
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
