import { NextResponse } from "next/server";
import { readErrorHistory } from "@/lib/ofx";

export async function GET() {
  const history = await readErrorHistory(20);
  return NextResponse.json(history);
}
