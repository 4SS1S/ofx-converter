import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error -- no types for the worker bundle
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;

const APP_TEMP_ROOT = path.join(process.cwd(), ".tmp");
const UPLOADS_DIR = path.join(APP_TEMP_ROOT, "uploads");
const DOWNLOADS_DIR = path.join(APP_TEMP_ROOT, "downloads");
const ERROR_LOG_PATH = path.join(APP_TEMP_ROOT, "error-history.log");

let cleanupTimerStarted = false;

export async function logError(entry: Record<string, unknown>) {
  await fs.mkdir(APP_TEMP_ROOT, { recursive: true });

  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

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
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
}

export function startDailyCleanup() {
  if (cleanupTimerStarted) {
    return;
  }

  cleanupTimerStarted = true;

  void cleanupOldFiles();

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      void cleanupOldFiles();
    }
  }, 60_000);
}

export async function cleanupOldFiles() {
  await ensureTempFolders();

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const directory of [UPLOADS_DIR, DOWNLOADS_DIR]) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      try {
        const stats = await fs.stat(fullPath);
        if (stats.mtimeMs < cutoff) {
          await fs.unlink(fullPath);
        }
      } catch {
        // Ignore cleanup failures for files that are already gone.
      }
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

  let generatedText = "";

  try {
    generatedText = await extractTextFromBuffer(buffer, fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao extrair conteúdo do arquivo.";
    await logError({
      type: "conversion",
      fileName,
      message,
      size: buffer.length,
    });
    throw new Error(`Arquivo inválido para conversão: ${message}`);
  } finally {
    await fs.unlink(sourcePath).catch(() => undefined);
  }

  const outputId = randomUUID();
  const outputPath = path.join(DOWNLOADS_DIR, `${outputId}.ofx`);
  const ofxContent = buildOfxDocument(safeBaseName, generatedText);

  await fs.writeFile(outputPath, ofxContent, "utf8");

  return {
    downloadUrl: `/api/download/${outputId}`,
    fileName: `${safeBaseName}.ofx`,
  };
}

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

  if (extension === ".pdf") {
    return extractPdfText(buffer);
  }

  if (extension === ".docx") {
    return extractDocxText(buffer);
  }

  if (extension === ".txt") {
    return buffer.toString("utf8");
  }

  return buffer.toString("utf8", 0, Math.min(buffer.length, 20_000));
}

async function extractPdfText(buffer: Buffer) {
  try {
    const data = new Uint8Array(buffer);
    const doc = await getDocument({ data, useWorkerFetch: false, useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ler PDF.";
    throw new Error(`PDF inválido ou corrompido: ${message}`);
  }
}

async function extractDocxText(buffer: Buffer) {
  try {
    const result = await mammoth.extractRawText({
      buffer: buffer as Buffer,
    });
    return result.value || "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ler DOCX.";
    throw new Error(`DOCX inválido ou corrompido: ${message}`);
  }
}

function buildOfxDocument(fileName: string, content: string) {
  const statementDate = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 14);
  const cleanContent = normalizeText(content);
  const summary = cleanContent || `Converted document: ${fileName}`;
  const memo = summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
  const trnId = createHash("sha1")
    .update(`${fileName}-${statementDate}-${Math.random().toString(16)}`)
    .digest("hex")
    .slice(0, 12);

  return `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <DTSERVER>${statementDate}</DTSERVER>
      <LANGUAGE>ENG</LANGUAGE>
      <FI>
        <ORG>OFX Converter</ORG>
        <FID>0000</FID>
      </FI>
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>${trnId}</TRNUID>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <STMTRS>
        <CURDEF>USD</CURDEF>
        <BANKACCTFROM>
          <BANKID>000000001</BANKID>
          <ACCTID>${escapeXml(fileName).slice(0, 20)}</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${statementDate}</DTSTART>
          <DTEND>${statementDate}</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>${statementDate}</DTPOSTED>
            <TRNAMT>0.00</TRNAMT>
            <FITID>${trnId}</FITID>
            <NAME>${escapeXml(fileName)}</NAME>
            <MEMO>${escapeXml(memo)}</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
