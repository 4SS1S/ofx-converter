import { NextResponse } from "next/server";
import { convertUploadedFile, startDailyCleanup } from "@/lib/ofx";

export async function POST(request: Request) {
  startDailyCleanup();

  const formData = await request.formData();
  const uploadedFile = formData.get("file");

  if (!(uploadedFile instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo em PDF, DOCX ou TXT." }, { status: 400 });
  }

  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const result = await convertUploadedFile(uploadedFile.name, buffer);

  return NextResponse.json({
    message: "Seu documento foi convertido para OFX com sucesso.",
    downloadUrl: result.downloadUrl,
    filename: result.fileName,
  });
}
