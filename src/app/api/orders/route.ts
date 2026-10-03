import { NextResponse } from "next/server";
import { fetchOrders } from "@/lib/googleSheets";

export async function GET() {
  try {
    const orders = await fetchOrders();
    return NextResponse.json({ orders });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch orders." },
      { status: 500 }
    );
  }
}
