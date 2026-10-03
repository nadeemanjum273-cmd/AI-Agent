import { NextResponse } from "next/server";
import { COMPANY_POLICY } from "@/lib/policy";

export async function GET() {
  return NextResponse.json({ policy: COMPANY_POLICY });
}
