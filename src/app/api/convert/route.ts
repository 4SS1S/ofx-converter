import { NextResponse } from "next/server";
import { convertUploadedFile, logError, startDailyCleanup } from "@/lib/ofx";

export async function POST(request: Request) {
  startDailyCleanup();

  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("file");

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo em PDF, DOCX ou TXT." }, { status: 400 });
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());

    if (buffer.length === 0) {
      throw new Error("Arquivo vazio ou inválido.");
    }

    const result = await convertUploadedFile(uploadedFile.name, buffer);

    return NextResponse.json({
      message: "Seu documento foi convertido para OFX com sucesso.",
      downloadUrl: result.downloadUrl,
      filename: result.fileName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao converter o arquivo.";
    await logError({
      type: "api-convert",
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
