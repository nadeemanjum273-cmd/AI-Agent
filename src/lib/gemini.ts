import { GoogleGenAI } from "@google/genai";
import { fetchProducts, fetchOrders, getOrderById, updateOrderStatus, saveBankDetails, logInteraction, createNewOrder } from "./googleSheets";
import { COMPANY_POLICY, evaluateRefundEligibility } from "./policy";
import { sendRefundConfirmationEmail } from "./emailService";

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export async function processAgentConversation(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const lastUserMsg = messages[messages.length - 1]?.content.trim().toLowerCase() || "";

  // RULE 1: GREETING BEHAVIOR FOR NADEEM TECHMART AI
  if (isPureGreeting(lastUserMsg)) {
    return {
      text: "Hello! I am Nadeem Techmart AI. How can I help you today?",
      timestamp: new Date().toISOString()
    };
  }

  // SYSTEM INSTRUCTION FOR NADEEM TECHMART AI
  const systemInstruction = `
You are Nadeem Techmart AI, an AI Customer & Sales Support Agent at "TechMart".
Your goal is to provide concise, accurate, and direct assistance based strictly on company databases, Google Sheets, and policy documents.

STRICT OPERATIONAL RULES:

1. GREETINGS & INITIAL RESPONSE:
   - If the user greets (e.g. "Hi", "Hello"), reply ONLY with: "Hello! I am Nadeem Techmart AI. How can I help you today?"

2. ORDER PLACEMENT WORKFLOW:
   - When a customer wants to buy, purchase, or place an order for any item (e.g., "I want to buy Google Pixel 9 Pro" or "confirm purchase" or "place order"), confirm their purchase and inform them that their order has been placed and added directly to the Google Sheets Orders tab.

3. PRODUCT & PRICING QUERIES:
   - When asked for product prices, specifications, or models, query the product database and return relevant products matching the query.

4. REFUND & RETURN POLICIES:
   - Electronics have a 15-day return policy from purchase date. Standard items have a 30-day return policy. Items must be unused in original packaging.

5. REFUND REQUEST WORKFLOW:
   - STEP 1: Ask for Order ID (e.g. ORD-101).
   - STEP 2: Look up order in Google Sheets and evaluate policy.
   - STEP 3: If eligible, approve refund, send email, and request bank details.
`;

  // Fetch Live Snapshot for Gemini Context
  const [products, orders] = await Promise.all([fetchProducts(), fetchOrders()]);

  const productSummary = products
    .map(
      (p) =>
        `- Name: ${p.name} | ID: ${p.id} | Category: ${p.category} | Price: $${p.price} | Stock: ${p.stock} | Specs/Desc: ${p.description}`
    )
    .join("\n");

  const orderSummary = orders
    .map(
      (o) =>
        `- Order #${o.order_id}: Customer ${o.customer_name} (${o.customer_email}), Product: ${o.product_name}, Total: $${o.total_price}, Date: ${o.order_date}, Status: ${o.status}, Electronics: ${o.is_electronics}`
    )
    .join("\n");

  const fullPrompt = `
KNOWLEDGE BASE CONTEXT:

--- GOOGLE SHEETS PRODUCTS TAB ---
${productSummary}

--- GOOGLE SHEETS ORDERS TAB ---
${orderSummary}

--- USER CONVERSATION HISTORY ---
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}

Respond strictly adhering to Nadeem Techmart AI rules.
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: fullPrompt,
      config: {
        systemInstruction,
        temperature: 0.2
      }
    });

    const aiAnswer = response.text || "Hello! I am Nadeem Techmart AI. How can I help you today?";

    // Execute side-effect actions (Order creation, Refund lookup, Bank Details capture, Sheet update)
    await handleAgentActions(messages, aiAnswer);

    return {
      text: aiAnswer,
      timestamp: new Date().toISOString()
    };
  } catch (err: any) {
    console.warn("Gemini API call error, executing rule-based agent logic:", err);
    return fallbackAgentReasoning(messages, products, orders);
  }
}

function isPureGreeting(text: string): boolean {
  const g = text.replace(/[^a-z]/g, "");
  return ["hi", "hello", "hey", "hola", "greetings", "hiii", "helo"].includes(g);
}

async function handleAgentActions(messages: ChatMessage[], aiText: string) {
  const fullConversation = messages.map((m) => m.content).join(" ") + " " + aiText;
  const lastUserMsg = messages[messages.length - 1]?.content || "";

  // Check for Order Placement Intent (buy, purchase, order, confirm)
  const isOrderCreation = /buy|purchase|place order|order item|confirm order|proceed with the purchase/i.test(lastUserMsg) ||
    /finalize your order|confirm if you would like to proceed/i.test(aiText);

  if (isOrderCreation) {
    let productName = "electronics";
    if (lastUserMsg.toLowerCase().includes("pixel")) productName = "phone";
    else if (lastUserMsg.toLowerCase().includes("macbook") || lastUserMsg.toLowerCase().includes("laptop")) productName = "laptop";
    else if (lastUserMsg.toLowerCase().includes("headphone") || lastUserMsg.toLowerCase().includes("sony")) productName = "headphones";
    else if (lastUserMsg.toLowerCase().includes("tablet") || lastUserMsg.toLowerCase().includes("ipad")) productName = "tablet";

    await createNewOrder("Nadeem", productName, "electronics");
  }

  // Check for Order ID / Refund Intent
  const orderIdMatch = fullConversation.match(/ORD-\d{3,4}/i);
  if (orderIdMatch) {
    const orderId = orderIdMatch[0].toUpperCase();
    const isRefundIntent = /refund|return|money back|cancel/i.test(lastUserMsg);

    if (isRefundIntent) {
      const order = await getOrderById(orderId);
      if (order) {
        const evalResult = evaluateRefundEligibility(order.order_date, order.is_electronics);
        if (evalResult.eligible) {
          await updateOrderStatus(order.order_id, "Refund Approved");
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
            details: `Refund approved for order ${orderId}. Email sent.`
          });
        }
      }
    }
  }

  // Check for Bank Details Capture
  const bankMatch = lastUserMsg.match(/(bank|account|acc|mobile|phone|number)/i);
  if (bankMatch) {
    const numbers = lastUserMsg.match(/\d{8,15}/g);
    if (numbers && numbers.length >= 1) {
      await saveBankDetails({
        customer_email: "customer@example.com",
        order_id: orderIdMatch ? orderIdMatch[0].toUpperCase() : "ORD-103",
        bank_name: "Customer Bank",
        account_number: numbers[0],
        mobile_number: numbers[1] || "N/A"
      });
    }
  }
}

/**
 * Deterministic Rule-Based Fallback logic for NAdeem Techmart Agent
 */
async function fallbackAgentReasoning(
  messages: ChatMessage[],
  products: any[],
  orders: any[]
): Promise<{ text: string; timestamp: string }> {
  const lastMsg = messages[messages.length - 1]?.content.trim().toLowerCase() || "";

  // Rule 1: Greeting
  if (isPureGreeting(lastMsg)) {
    return {
      text: "Hello! I am Nadeem Techmart AI. How can I help you today?",
      timestamp: new Date().toISOString()
    };
  }

  // Rule 2: Order Placement / Purchase Confirmation
  if (lastMsg.includes("buy") || lastMsg.includes("purchase") || lastMsg.includes("confirm") || lastMsg.includes("order")) {
    let productName = "laptop";
    if (lastMsg.includes("pixel") || lastMsg.includes("phone")) productName = "phone";
    else if (lastMsg.includes("macbook") || lastMsg.includes("laptop")) productName = "laptop";
    else if (lastMsg.includes("headphone") || lastMsg.includes("sony")) productName = "headphones";
    else if (lastMsg.includes("tablet") || lastMsg.includes("ipad")) productName = "tablet";

    const newOrder = await createNewOrder("Nadeem", productName, "electronics");

    return {
      text: `### 🎉 Order Placed Successfully!
Your order for **${productName}** has been confirmed and placed into our system.

**Order Summary:**
- **Order ID:** \`${newOrder.order_id}\`
- **Customer:** ${newOrder.customer_name}
- **Item:** ${newOrder.product_name}
- **Status:** Recorded in Google Sheets **Orders** tab!`,
      timestamp: new Date().toISOString()
    };
  }

  // Product & Pricing Queries
  if (lastMsg.includes("pixel") || lastMsg.includes("phone")) {
    const phones = products.filter((p) => p.category.toLowerCase().includes("phone") || p.name.toLowerCase().includes("pixel"));
    const responseText = `### Available Phones
` + phones.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}\n  *Specs:* ${p.description}`).join("\n\n");
    return { text: responseText, timestamp: new Date().toISOString() };
  }

  if (lastMsg.includes("laptop") || lastMsg.includes("macbook") || lastMsg.includes("dell")) {
    const laptops = products.filter((p) => p.category.toLowerCase().includes("laptop") || p.name.toLowerCase().includes("dell") || p.name.toLowerCase().includes("macbook"));
    const responseText = `### Laptops Catalog
` + laptops.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}\n  *Specs:* ${p.description}`).join("\n\n");
    return { text: responseText, timestamp: new Date().toISOString() };
  }

  if (lastMsg.includes("product") || lastMsg.includes("price")) {
    const responseText = `### Products Catalog (Google Sheets)
` + products.slice(0, 10).map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}`).join("\n");
    return { text: responseText, timestamp: new Date().toISOString() };
  }

  // Return & Refund Policy
  if (lastMsg.includes("policy") || lastMsg.includes("return") || lastMsg.includes("refund")) {
    return {
      text: `### Company Return & Refund Policy
- **Electronics Return Window:** Items such as laptops, phones, tablets, and watches have a **15-day return policy** from the date of purchase.
- **Condition:** Items must be unused and in original packaging.
- **Processing Time:** Approved refunds are processed within 5 business days.`,
      timestamp: new Date().toISOString()
    };
  }

  return {
    text: "Hello! I am Nadeem Techmart AI. How can I help you today?",
    timestamp: new Date().toISOString()
  };
}
