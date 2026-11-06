/** biome-ignore-all lint/a11y/noStaticElementInteractions: <explanation> */
"use client";

import { useEffect, useRef, useState } from "react";

type ErrorLog = {
  timestamp?: string;
  message?: string;
};

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState("Ainda não há arquivo selecionado.");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("");
  const [errorHistory, setErrorHistory] = useState<ErrorLog[]>([]);

  useEffect(() => {
    const fetchErrorHistory = async () => {
      try {
        const response = await fetch("/api/errors");
        const payload = await response.json();
        setErrorHistory(Array.isArray(payload) ? payload : []);
      } catch {
        setErrorHistory([]);
      }
    };

    void fetchErrorHistory();
  }, []);

  const handleSelectedFile = (file?: File) => {
    if (!file) {
      return;
    }

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/msword",
    ];

    const hasSupportedExtension = [".pdf", ".docx", ".txt"].some((extension) =>
      file.name.toLowerCase().endsWith(extension),
    );

    if (!hasSupportedExtension && !validTypes.includes(file.type)) {
      setStatus("Tipo de arquivo não suportado. Escolha um PDF, DOCX ou TXT.");
      return;
    }

    setSelectedFile(file);
    setDownloadUrl(null);
    setStatus(`${file.name} está pronto para conversão.`);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    handleSelectedFile(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    handleSelectedFile(file);
  };

  const handleConvert = async () => {
    if (!selectedFile) {
      setStatus("Selecione um arquivo antes de converter.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    setIsUploading(true);
    setStatus("Convertendo seu arquivo para OFX...");

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível converter o arquivo.");
      }

      setDownloadUrl(payload.downloadUrl);
      setDownloadName(payload.filename);
      setStatus(payload.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha na conversão. Tente novamente.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#eff6ff,_#f8fafc_45%,_#e2e8f0_100%)] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-700">Conversor OFX</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
              Converta documentos para OFX em segundos.
            </h1>
          </div>
          <div className="rounded-full border border-blue-200 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
            PDF • DOCX • TXT
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-lg shadow-slate-200/60 backdrop-blur">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
                isDragging
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-300 bg-slate-50/80"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={handleInputChange}
              />

              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-2xl text-blue-700">
                ⤴
              </div>
              <p className="mt-5 text-lg font-semibold text-slate-900">
                Arraste e solte um arquivo aqui
              </p>
              <p className="mt-2 text-sm text-slate-600">
                ou clique no botão abaixo para escolher um documento.
              </p>

              {selectedFile ? (
                <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  {selectedFile.name}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Escolher arquivo
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={!selectedFile || isUploading}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isUploading ? "Convertendo..." : "Converter para OFX"}
              </button>
            </div>

            <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {status}
            </p>
          </div>

          <aside className="rounded-3xl border border-slate-200 bg-slate-900 p-6 text-slate-200 shadow-lg shadow-slate-300/40">
            <h2 className="text-xl font-semibold text-white">O que acontece agora</h2>
            <ol className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
              <li>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
                  1
                </span>
                Seu arquivo enviado é salvo em uma pasta temporária.
              </li>
              <li>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
                  2
                </span>
                O conteúdo é extraído e transformado em um arquivo OFX válido.
              </li>
              <li>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
                  3
                </span>
                O arquivo original é removido e um link de download é gerado.
              </li>
            </ol>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-800 p-4">
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  download={downloadName}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Baixar arquivo OFX
                </a>
              ) : (
                <p className="text-sm text-slate-400">Seu arquivo OFX gerado aparecerá aqui.</p>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                Histórico local de erros
              </h3>
              {errorHistory.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum erro registrado até o momento.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-300">
                  {errorHistory.slice(-5).reverse().map((log, index) => (
                    <li key={`${log.timestamp ?? index}-${index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
                      <div className="font-medium text-slate-100">{log.timestamp ?? "Sem data"}</div>
                      <div className="mt-1 break-words text-slate-300">{log.message ?? "Erro desconhecido"}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
