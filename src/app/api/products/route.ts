import { NextResponse } from "next/server";
import { fetchProducts } from "@/lib/googleSheets";

export async function GET() {
  try {
    const products = await fetchProducts();
    return NextResponse.json({ products });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch products." },
      { status: 500 }
    );
  }
}
