import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Identificador do arquivo ausente." }, { status: 400 });
  }

  const downloadPath = path.join(process.cwd(), ".tmp", "downloads", `${id}.ofx`);

  try {
    const file = await fs.readFile(downloadPath);

    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/ofx+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.ofx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "O arquivo OFX solicitado não foi encontrado." }, { status: 404 });
  }
}
