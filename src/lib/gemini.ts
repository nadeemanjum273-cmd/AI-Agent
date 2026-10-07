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

  // RULE 1: GREETING BEHAVIOR FOR MIND_DREAM AI
  if (isPureGreeting(lastUserMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I help you today?",
      timestamp: new Date().toISOString()
    };
  }

  // SYSTEM INSTRUCTION FOR MIND_DREAM AI
  const systemInstruction = `
You are Mind_Dream AI, an AI Customer & Sales Support Agent.
Your goal is to provide concise, accurate, and direct assistance based strictly on company databases, Google Sheets, and policy documents.

STRICT OPERATIONAL RULES:

1. GREETINGS & INITIAL RESPONSE:
   - If the user greets (e.g. "Hi", "Hello"), reply ONLY with: "Hello! I am Mind_Dream AI. How can I help you today?"

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

Respond strictly adhering to Mind_Dream AI rules.
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: fullPrompt,
      config: {
        systemInstruction,
        temperature: 0.2
      }
    });

    const aiAnswer = response.text || "Hello! I am Mind_Dream AI. How can I help you today?";

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
  const lowerMsg = lastUserMsg.toLowerCase();

  const isReturnRefund = /return|refund|money back|cancel|exchange/i.test(lowerMsg);

  // Check for Order Placement Intent ONLY if NOT return/refund
  const isOrderCreation = !isReturnRefund && (/buy|purchase|place order|want to order|confirm purchase/i.test(lowerMsg) ||
    /finalize your order|confirm if you would like to proceed/i.test(aiText));

  if (isOrderCreation) {
    let productName = "electronics";
    if (lowerMsg.includes("pixel") || lowerMsg.includes("phone")) productName = "phone";
    else if (lowerMsg.includes("macbook") || lowerMsg.includes("laptop") || lowerMsg.includes("dell")) productName = "laptop";
    else if (lowerMsg.includes("headphone") || lowerMsg.includes("sony")) productName = "headphones";
    else if (lowerMsg.includes("mouse")) productName = "mouse";
    else if (lowerMsg.includes("keyboard")) productName = "keyboard";
    else if (lowerMsg.includes("tablet") || lowerMsg.includes("ipad")) productName = "tablet";

    const nameMatch = lowerMsg.match(/i am ([a-z]+)/i);
    const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "Customer";

    await createNewOrder(customerName, productName, "electronics");
  }

  // Check for Order ID / Refund Intent
  const orderIdMatch = fullConversation.match(/ORD-\d{3,4}/i);
  if (orderIdMatch) {
    const orderId = orderIdMatch[0].toUpperCase();
    if (isReturnRefund) {
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
  const bankMatch = lowerMsg.match(/(bank|account|acc|mobile|phone|number)/i);
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
 * Deterministic Rule-Based Reasoning logic for Mind_Dream AI
 */
async function fallbackAgentReasoning(
  messages: ChatMessage[],
  products: any[],
  orders: any[]
): Promise<{ text: string; timestamp: string }> {
  const lastMsg = messages[messages.length - 1]?.content.trim().toLowerCase() || "";

  // 1. Pure Greeting
  if (isPureGreeting(lastMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I help you today?",
      timestamp: new Date().toISOString()
    };
  }

  // 2. Return / Refund / Cancel Intent (HIGHEST PRIORITY over order creation)
  const isReturnRefund = /return|refund|money back|cancel|exchange/i.test(lastMsg);
  if (isReturnRefund) {
    const orderIdMatch = lastMsg.match(/ORD-\d{3,4}/i);
    if (orderIdMatch) {
      const orderId = orderIdMatch[0].toUpperCase();
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
          return {
            text: `### ✅ Refund Approved!
Order **${orderId}** (${order.product_name}) purchased by **${order.customer_name}** is eligible for a full refund of **$${order.total_price}**.

- **Status:** Updated live in Google Sheets to \`Refund Approved\`.
- **Confirmation Email:** Dispatched to \`${order.customer_email}\`.

Please reply with your **Bank Account Number** and **Mobile Number** so we can process your payout directly!`,
            timestamp: new Date().toISOString()
          };
        } else {
          return {
            text: `### ❌ Return Ineligible
Order **${orderId}** was purchased on **${order.order_date}** (${evalResult.daysElapsed} days ago).
Electronics have a strict **15-day return limit**. ${evalResult.reason}`,
            timestamp: new Date().toISOString()
          };
        }
      } else {
        return {
          text: `Order \`${orderId}\` was not found in our Google Sheets records. Please check the Order ID and try again.`,
          timestamp: new Date().toISOString()
        };
      }
    }

    // Extract customer name if mentioned (e.g. "i am abis want to return my order")
    const nameMatch = lastMsg.match(/i am ([a-z]+)/i);
    const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "";

    return {
      text: `### 🔄 Return & Refund Request${customerName ? ` for ${customerName}` : ""}
I would be glad to help you process your return!

Please reply with your **Order ID** (for example: \`ORD-101\` or \`ORD-105\`) so I can locate your order in Google Sheets and evaluate your return eligibility.`,
      timestamp: new Date().toISOString()
    };
  }

  // 3. Explicit Order Placement Intent (buy / purchase / place order)
  const isOrderPlacement = /buy|purchase|place order|want to order|confirm purchase/i.test(lastMsg);
  if (isOrderPlacement) {
    let productName = "laptop";
    if (lastMsg.includes("pixel") || lastMsg.includes("phone") || lastMsg.includes("iphone") || lastMsg.includes("samsung")) productName = "phone";
    else if (lastMsg.includes("macbook") || lastMsg.includes("dell") || lastMsg.includes("laptop") || lastMsg.includes("hp") || lastMsg.includes("lenovo")) productName = "laptop";
    else if (lastMsg.includes("headphone") || lastMsg.includes("sony") || lastMsg.includes("airpods") || lastMsg.includes("bose")) productName = "headphones";
    else if (lastMsg.includes("mouse") || lastMsg.includes("logitech") || lastMsg.includes("razer")) productName = "mouse";
    else if (lastMsg.includes("keyboard")) productName = "keyboard";
    else if (lastMsg.includes("tablet") || lastMsg.includes("ipad")) productName = "tablet";

    const nameMatch = lastMsg.match(/i am ([a-z]+)/i);
    const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "Customer";

    const newOrder = await createNewOrder(customerName, productName, "electronics");

    return {
      text: `### 🎉 Order Placed Successfully!
Your order for **${productName}** has been confirmed and placed into our system.

**Order Summary:**
- **Order ID:** \`${newOrder.order_id}\`
- **Customer:** ${newOrder.customer_name}
- **Item:** ${newOrder.product_name}
- **Status:** Recorded live in Google Sheets **Orders** tab!`,
      timestamp: new Date().toISOString()
    };
  }

  // 4. Product & Pricing Queries (Smart Dynamic Filtering for query terms like "dell mouse", "laptop", "phone")
  const isProductQuery = /price|cost|product|catalog|stock|item|spec|mouse|keyboard|laptop|phone|headphone|tablet|dell|apple|sony|samsung|pixel|macbook|logitech|razer/i.test(lastMsg);
  if (isProductQuery) {
    const stopWords = new Set(["tell", "me", "prices", "price", "cost", "of", "the", "is", "a", "an", "for", "i", "want", "show", "what", "are", "have", "you"]);
    const keywords = lastMsg.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase()).filter((w) => w.length > 1 && !stopWords.has(w));

    let matching = products;
    if (keywords.length > 0) {
      matching = products.filter((p) => {
        const fullText = `${p.name} ${p.category} ${p.description}`.toLowerCase();
        return keywords.some((k) => fullText.includes(k));
      });
    }

    if (matching.length === 0) matching = products.slice(0, 5);

    const titleStr = keywords.length > 0 ? `Products matching "${keywords.join(" ")}"` : "Products Catalog";
    const responseText = `### 🛒 ${titleStr}\n` + matching.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}\n  *Category:* ${p.category} | *Specs:* ${p.description || "N/A"}`).join("\n\n");

    return { text: responseText, timestamp: new Date().toISOString() };
  }

  // 5. Order Lookup by ID
  const orderIdMatch = lastMsg.match(/ORD-\d{3,4}/i);
  if (orderIdMatch) {
    const orderId = orderIdMatch[0].toUpperCase();
    const order = await getOrderById(orderId);
    if (order) {
      return {
        text: `### 📦 Order Details (\`${order.order_id}\`)
- **Customer:** ${order.customer_name} (${order.customer_email})
- **Product:** ${order.product_name}
- **Total Price:** $${order.total_price}
- **Purchase Date:** ${order.order_date}
- **Status:** **${order.status}**`,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 6. Policy Questions
  if (/policy|return policy|refund policy|rules/i.test(lastMsg)) {
    return {
      text: `### 📋 Company Return & Refund Policy
- **Electronics Return Window:** 15 days from purchase date.
- **Standard Items:** 30 days from purchase date.
- **Condition:** Must be unused and in original packaging.
- **Refund Payouts:** Approved refunds are processed within 5 business days upon receiving bank details.`,
      timestamp: new Date().toISOString()
    };
  }

  return {
    text: "Hello! I am Mind_Dream AI. How can I help you today?",
    timestamp: new Date().toISOString()
  };
}
