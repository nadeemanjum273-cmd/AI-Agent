import { NextResponse } from "next/server";
import { fetchLogs } from "@/lib/googleSheets";

export async function GET() {
  try {
    const logs = await fetchLogs();
    return NextResponse.json({ logs });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch interaction logs." },
      { status: 500 }
    );
  }
}
