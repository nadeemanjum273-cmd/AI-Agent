import { NextRequest, NextResponse } from "next/server";
import { processAgentConversation, ChatMessage } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = body.messages || [];

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array cannot be empty." },
        { status: 400 }
      );
    }

    const response = await processAgentConversation(messages);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Chat API endpoint error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process chat message." },
      { status: 500 }
    );
  }
}
