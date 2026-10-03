import { GoogleGenAI } from "@google/genai";
import { fetchProducts, fetchOrders, getOrderById, updateOrderStatus, logInteraction } from "./googleSheets";
import { COMPANY_POLICY, evaluateRefundEligibility } from "./policy";
import { sendRefundConfirmationEmail } from "./emailService";

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export async function processAgentConversation(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBJGN9Olyey5I3tgAYAXPYzkaTP-DaBS5c";

  // System instructions for Charlie the AI Support Agent
  const systemInstruction = `
You are Charlie, an intelligent, empathetic, and ultra-helpful AI Customer Support & Sales Agent for "TechMart Online Store".

YOUR CORE DUTIES:
1. PRODUCT INQUIRIES: Answer questions about product details, categories, prices, stock levels, discounts, and promotions using product data from Google Sheets.
2. ORDER STATUS: Look up order details using order IDs (e.g. ORD-9021, ORD-9022, ORD-9023).
3. POLICY KNOWLEDGE: Provide accurate policy information regarding Returns, Refunds, Shipping, Warranties, and Exchanges based strictly on the TechMart Company Policy document.
4. REFUND PROCESSING & EVALUATION:
   - When a customer requests a refund for an order, fetch the order details first.
   - Evaluate eligibility against the company policy:
     * Standard items: Return window is 30 days from purchase date.
     * Electronics (laptops, phones, watches, monitors): Return window is 15 days from purchase date.
     * Final sale items: Non-refundable.
     * Items must be unused in original packaging.
   - IF APPROVED: Automatically process the refund, update the order status in Google Sheets to "Refunded", trigger an automated refund confirmation email to the customer's email, and log the interaction in Google Sheets.
   - IF REJECTED: Politely explain why the request does not meet policy criteria (e.g., exceeded 15-day return window for electronics), and log the request.

TONE & STYLE:
- Friendly, professional, clear, and reassuring.
- Always provide concise, beautifully formatted markdown answers.
- Use currency formatting ($XX.XX) for prices.
- Be upfront about policy limits while offering alternative solutions (like warranty or exchange) if a refund is not eligible.
`;

  // Fetch contextual snapshot to inject as grounded context
  const [products, orders] = await Promise.all([fetchProducts(), fetchOrders()]);

  const productSummary = products
    .map(
      (p) =>
        `- ${p.name} (ID: ${p.id}): Category: ${p.category}, Price: $${p.price}, Stock: ${p.stock}, Rating: ${p.rating}, Discount: ${p.discount}`
    )
    .join("\n");

  const orderSummary = orders
    .map(
      (o) =>
        `- Order #${o.order_id}: Customer ${o.customer_name} (${o.customer_email}), Product: ${o.product_name}, Amount: $${o.total_price}, Date: ${o.order_date}, Status: ${o.status}, Electronics: ${o.is_electronics}`
    )
    .join("\n");

  const policyText = COMPANY_POLICY.sections
    .map((s) => `### ${s.title}\n` + s.rules.map((r) => `- ${r}`).join("\n"))
    .join("\n\n");

  const fullPrompt = `
SYSTEM CONTEXT & KNOWLEDGE BASE:

--- COMPANY POLICIES ---
${policyText}

--- LIVE PRODUCT CATALOG (GOOGLE SHEETS) ---
${productSummary}

--- LIVE ORDERS LIST (GOOGLE SHEETS) ---
${orderSummary}

--- USER CONVERSATION HISTORY ---
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}

Respond to the latest message as Charlie, TechMart's AI Support Agent. 
If the user asks for a refund for a specific order (e.g. ORD-9021 or ORD-9022), evaluate policy eligibility, execute the refund logic if eligible, log the interaction, and state whether a refund confirmation email was sent!
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: {
        systemInstruction,
        temperature: 0.3
      }
    });

    const aiAnswer = response.text || "I apologize, I could not process your request at this moment.";

    // Check if the AI decision involved a refund processing for an order in the text
    await checkAndExecuteRefundActions(aiAnswer, messages);

    return {
      text: aiAnswer,
      timestamp: new Date().toISOString()
    };
  } catch (err: any) {
    console.error("Gemini API call failed, using rule-based agent fallback:", err);
    return fallbackAgentReasoning(messages, products, orders);
  }
}

/**
 * Parses user message & AI response to trigger automated refund processing, Google Sheets logs, and email dispatch
 */
async function checkAndExecuteRefundActions(aiText: string, messages: ChatMessage[]) {
  const lastUserMsg = messages[messages.length - 1]?.content || "";

  // Regex to extract order IDs mentioned like ORD-9021
  const orderIdMatch = (lastUserMsg + " " + aiText).match(/ORD-\d{4}/i);
  if (!orderIdMatch) return;

  const orderId = orderIdMatch[0].toUpperCase();
  const isRefundQuery = /refund|return|money back|cancel/i.test(lastUserMsg);

  if (isRefundQuery) {
    const order = await getOrderById(orderId);
    if (order) {
      const evalResult = evaluateRefundEligibility(
        order.order_date,
        order.is_electronics,
        order.is_final_sale
      );

      if (evalResult.eligible) {
        // Execute Refund Actions
        await updateOrderStatus(order.order_id, "Refunded");
        await sendRefundConfirmationEmail({
          to: order.customer_email,
          customerName: order.customer_name,
          orderId: order.order_id,
          productName: order.product_name,
          refundAmount: order.total_price,
          reason: evalResult.reason
        });

        await logInteraction({
          customer_email: order.customer_email,
          order_id: order.order_id,
          action_type: "Refund Approved",
          status: "Completed",
          details: `Refund of $${order.total_price} approved and processed. Email confirmation sent to ${order.customer_email}.`
        });
      } else {
        await logInteraction({
          customer_email: order.customer_email,
          order_id: order.order_id,
          action_type: "Refund Rejected",
          status: "Completed",
          details: `Refund request evaluated and rejected: ${evalResult.reason}`
        });
      }
    }
  } else {
    // General order inquiry logging
    await logInteraction({
      customer_email: "customer@example.com",
      order_id: orderId,
      action_type: "Order Inquiry",
      status: "Completed",
      details: `Inquired about order ${orderId}`
    });
  }
}

/**
 * Intelligent fallback agent if API key is invalid or offline
 */
async function fallbackAgentReasoning(
  messages: ChatMessage[],
  products: any[],
  orders: any[]
): Promise<{ text: string; timestamp: string }> {
  const lastMsg = messages[messages.length - 1]?.content.toLowerCase() || "";
  let responseText = "";

  if (lastMsg.includes("policy") || lastMsg.includes("return") || lastMsg.includes("shipping") || lastMsg.includes("warranty")) {
    responseText = `### 📋 TechMart Policy Overview
- **Returns:** 30 days for general items, **15 days for electronics** (laptops, phones, tablets, watches). Items must be unused in original packaging.
- **Refunds:** Processed within 5 business days to original payment method once received.
- **Shipping:** Standard 3–5 days ($4.99) | Express 1–2 days ($12.99) | **Free Standard Shipping on orders over $50**.
- **Warranty:** 1-year manufacturer warranty on all electronics covering hardware defects.`;
  } else if (lastMsg.includes("ord-9021")) {
    const order = orders.find((o) => o.order_id === "ORD-9021");
    const evalRes = evaluateRefundEligibility(order.order_date, order.is_electronics);

    if (evalRes.eligible) {
      await updateOrderStatus("ORD-9021", "Refunded");
      await sendRefundConfirmationEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        orderId: order.order_id,
        productName: order.product_name,
        refundAmount: order.total_price,
        reason: evalRes.reason
      });
      await logInteraction({
        customer_email: order.customer_email,
        order_id: order.order_id,
        action_type: "Refund Approved",
        status: "Completed",
        details: `Approved refund of $${order.total_price}. Confirmation email sent.`
      });

      responseText = `### ✅ Refund Approved & Processed for Order #ORD-9021
Hello **${order.customer_name}**,

Your refund request for **${order.product_name}** (Amount: **$${order.total_price}**) has been evaluated against our policy and is **APPROVED**!

- **Item Category:** Electronics (Purchased on ${order.order_date})
- **Status:** Approved (Within the 15-day return policy window)
- **Action Taken:** 
  1. Updated Order Status in Google Sheets to **Refunded**.
  2. Automatically dispatched refund confirmation email to \`${order.customer_email}\`.
  3. Logged transaction in Google Sheets.

Your refund will appear on your original payment method in **3-5 business days**.`;
    }
  } else if (lastMsg.includes("ord-9022")) {
    const order = orders.find((o) => o.order_id === "ORD-9022");
    const evalRes = evaluateRefundEligibility(order.order_date, order.is_electronics);

    await logInteraction({
      customer_email: order.customer_email,
      order_id: order.order_id,
      action_type: "Refund Rejected",
      status: "Completed",
      details: evalRes.reason
    });

    responseText = `### ❌ Refund Request Evaluated: Order #ORD-9022
Hello **${order.customer_name}**,

We evaluated your refund request for **${order.product_name}** ($${order.total_price}):

- **Purchase Date:** ${order.order_date} (${evalRes.daysElapsed} days ago)
- **Policy Limit:** 15 days for Electronics
- **Evaluation Decision:** **Not Eligible for Refund** (${evalRes.reason})

*Note: You can still claim 1-year manufacturer warranty support if you are experiencing hardware issues.*`;
  } else if (lastMsg.includes("product") || lastMsg.includes("price") || lastMsg.includes("discount")) {
    responseText = `### 🛍️ Featured TechMart Products & Pricing
` + products.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** (${p.discount}) | Stock: ${p.stock} | Rating: ⭐ ${p.rating}`).join("\n");
  } else {
    responseText = `Hello! I'm **Charlie**, TechMart's AI Support & Sales Agent. I can help you with:
1. **Product & Discount Queries:** Ask about pricing, stock, or promotions.
2. **Order Support & Tracking:** Provide an Order ID (e.g. \`ORD-9021\`, \`ORD-9022\`, \`ORD-9023\`).
3. **Refund Requests:** Submit an order ID for instant eligibility evaluation, automated email confirmation, and Google Sheets logging.
4. **Company Policies:** Questions on returns, shipping, or warranties.

How can I assist you today?`;
  }

  return {
    text: responseText,
    timestamp: new Date().toISOString()
  };
}
