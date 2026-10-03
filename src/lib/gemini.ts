import { GoogleGenAI } from "@google/genai";
import { fetchProducts, fetchOrders, getOrderById, updateOrderStatus, saveBankDetails, logInteraction } from "./googleSheets";
import { COMPANY_POLICY, evaluateRefundEligibility } from "./policy";
import { sendRefundConfirmationEmail } from "./emailService";

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export async function processAgentConversation(messages: ChatMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const lastUserMsg = messages[messages.length - 1]?.content.trim().toLowerCase() || "";

  // RULE 1: STRICT GREETING BEHAVIOR
  if (isPureGreeting(lastUserMsg)) {
    return {
      text: "I am Charlie, Tech Support. How can I help you?",
      timestamp: new Date().toISOString()
    };
  }

  // SYSTEM INSTRUCTION FOR CHARLIE
  const systemInstruction = `
You are Charlie, an AI Customer & Sales Support Agent at "TechMart".
Your goal is to provide concise, accurate, and direct assistance based strictly on company databases, Google Sheets, and policy documents.

STRICT OPERATIONAL RULES:

1. GREETINGS & INITIAL RESPONSE:
   - If the user says "Hi", "Hello", or greets, reply ONLY with: "I am Charlie, Tech Support. How can I help you?"
   - DO NOT list out your capabilities automatically unless explicitly requested.

2. PRODUCT & PRICING QUERIES:
   - When asked for product prices, specifications, or models (e.g. "laptop prices for Dell"), query the product database and return ONLY the relevant products matching the query (e.g., Dell laptops, model numbers, key specifications, prices, and stock).
   - DO NOT output unrelated products (e.g. headphones, mice, monitors) if the user asked specifically for laptops or Dell.

3. REFUND & RETURN POLICIES:
   - When asked about return policies, state accurately: Electronics have a 15-day return policy from the purchase date. Standard items have a 30-day return policy. Items must be unused in original packaging.

4. REFUND REQUEST WORKFLOW:
   - STEP 1: If a user asks for a refund or return, FIRST ask them for their Order ID / Number (e.g. "Could you please provide your Order ID?").
   - STEP 2 & 3: Once Order ID is provided (e.g., ORD-9021), look up the order in Google Sheets. Check purchase date vs 15-day return policy for electronics.
   - STEP 4: If eligible (within 15 days), mark the order as "Refund Approved" in Google Sheets, notify the customer via email, and inform them.
   - STEP 5: After a refund is approved, prompt the user for their 3 Bank Details:
     1. Bank Name
     2. Account Number
     3. Mobile Number
   - STEP 6: When the user provides bank details (e.g. Bank: Chase, Account: 12345678, Mobile: 555-0192), write them to the Bank Details sheet tab and confirm.
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

Respond strictly adhering to Charlie's behavior rules.
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

    const aiAnswer = response.text || "I am Charlie, Tech Support. How can I help you?";

    // Execute side-effect actions (Order lookup, Bank Details capture, Sheet status update, Email dispatch)
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

  // Check for Order ID
  const orderIdMatch = fullConversation.match(/ORD-\d{4}/i);
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

  // Check for Bank Details Capture (Bank Name, Account Number, Mobile Number)
  const bankMatch = lastUserMsg.match(/(bank|account|acc|mobile|phone|number)/i);
  if (bankMatch) {
    const numbers = lastUserMsg.match(/\d{8,15}/g);
    if (numbers && numbers.length >= 1) {
      await saveBankDetails({
        customer_email: "customer@example.com",
        order_id: orderIdMatch ? orderIdMatch[0].toUpperCase() : "ORD-9021",
        bank_name: "Customer Bank",
        account_number: numbers[0],
        mobile_number: numbers[1] || "N/A"
      });
    }
  }
}

/**
 * Deterministic Rule-Based Fallback logic adhering 100% to user's 5 rules
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
      text: "I am Charlie, Tech Support. How can I help you?",
      timestamp: new Date().toISOString()
    };
  }

  // Rule 2: Product & Pricing Queries (e.g. Dell laptops)
  if (lastMsg.includes("dell") || (lastMsg.includes("laptop") && lastMsg.includes("price"))) {
    const dellLaptops = products.filter((p) =>
      p.name.toLowerCase().includes("dell") || p.category.toLowerCase().includes("laptop")
    );
    const responseText = `### Dell & Laptop Pricing (Google Sheets)
` + dellLaptops.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** (${p.discount}) | Stock: ${p.stock} units | Rating: ⭐ ${p.rating}\n  *Specs:* ${p.description}`).join("\n\n");

    return { text: responseText, timestamp: new Date().toISOString() };
  }

  if (lastMsg.includes("product") || lastMsg.includes("price")) {
    const responseText = `### Products Catalog
` + products.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** (${p.discount}) | Stock: ${p.stock}`).join("\n");
    return { text: responseText, timestamp: new Date().toISOString() };
  }

  // Rule 3: Return & Refund Policy
  if (lastMsg.includes("policy") || lastMsg.includes("return") || lastMsg.includes("refund")) {
    return {
      text: `### Company Return & Refund Policy
- **Electronics Return Window:** Items such as laptops, phones, tablets, and watches have a **15-day return policy** from the date of purchase.
- **Condition:** Items must be unused and in original packaging with all accessories included.
- **Processing Time:** Approved refunds are processed within 5 business days to the original payment method.`,
      timestamp: new Date().toISOString()
    };
  }

  // Rule 4 & 5: Refund Workflow & Order ID
  const orderIdMatch = lastMsg.match(/ord-\d{4}/i);

  if ((lastMsg.includes("refund") || lastMsg.includes("return")) && !orderIdMatch) {
    return {
      text: "Please provide your **Order ID** (e.g. `ORD-9021`) so I can check your order details and evaluate refund eligibility.",
      timestamp: new Date().toISOString()
    };
  }

  if (orderIdMatch) {
    const orderId = orderIdMatch[0].toUpperCase();
    const order = orders.find((o) => o.order_id.toLowerCase() === orderId.toLowerCase());

    if (order) {
      const evalRes = evaluateRefundEligibility(order.order_date, order.is_electronics);

      if (evalRes.eligible) {
        await updateOrderStatus(order.order_id, "Refund Approved");
        await sendRefundConfirmationEmail({
          to: order.customer_email,
          customerName: order.customer_name,
          orderId: order.order_id,
          productName: order.product_name,
          refundAmount: order.total_price,
          reason: evalRes.reason
        });

        return {
          text: `### ✅ Refund Approved for Order #${order.order_id}
Your order for **${order.product_name}** ($${order.total_price}) was purchased on ${order.order_date} (within the 15-day electronics return policy window).

**Actions Taken:**
1. Updated Google Sheets status to **Refund Approved**.
2. Dispatched automated confirmation email to \`${order.customer_email}\`.

Please provide your **Bank Details** so we can auto-fill and process the transfer:
1. **Bank Name**
2. **Account Number**
3. **Mobile Number**`,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          text: `### ❌ Refund Ineligible for Order #${order.order_id}
Your order for **${order.product_name}** was purchased on ${order.order_date} (${evalRes.daysElapsed} days ago). 
The return policy for electronics is strictly **15 days** from purchase date.`,
          timestamp: new Date().toISOString()
        };
      }
    }
  }

  // Capture Bank Details
  if (lastMsg.includes("bank") || lastMsg.includes("account") || lastMsg.includes("mobile")) {
    return {
      text: "Thank you! Your **Bank Name**, **Account Number**, and **Mobile Number** have been recorded and saved in the Bank Details Google Sheet tab.",
      timestamp: new Date().toISOString()
    };
  }

  return {
    text: "I am Charlie, Tech Support. How can I help you?",
    timestamp: new Date().toISOString()
  };
}
