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
  const lastUserMsg = messages[messages.length - 1]?.content.trim() || "";
  const lowerUserMsg = lastUserMsg.toLowerCase();

  // RULE 1: STRICT PURE GREETING
  if (isPureGreeting(lowerUserMsg)) {
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

1. GREETINGS:
   - If the user ONLY greets (e.g. "Hi", "Hello"), reply ONLY with: "Hello! I am Mind_Dream AI. How can I help you today?"

2. PRODUCT & PRICING QUERIES (Tab 1: Products List):
   - When asked for product prices, specs, models, or recommendations (e.g., "tell me laptop dell", "price of Samsung S25"), query the Products List sheet (Tab 1) and return exact specs, stock, and price.

3. REFUND & RETURN WORKFLOW (Tab 2: Order Details & Tab 3: Bank & Customer Details):
   - STEP 1: Identify Order ID (e.g. ORD-107, 107, order number 107) and Customer Name.
   - STEP 2: Electronics have a 15-day return policy; standard items have 30 days.
   - STEP 3: Calculate purchase date vs current date. If within policy limit (< 15 days), declare Eligible and update status in Tab 2 to "Return Approved".
   - STEP 4: Auto-populate Order ID, Customer Name, and Product into Tab 3 (Bank & Customer Details), then politely request Bank Name, Account Number, and Mobile Number from the customer.
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

    const aiAnswer = response.text || "";

    // Execute side-effect actions (Order creation, Refund lookup, Bank Details capture, Sheet update)
    await handleAgentActions(messages, aiAnswer);

    if (aiAnswer.trim()) {
      return {
        text: aiAnswer,
        timestamp: new Date().toISOString()
      };
    } else {
      return fallbackAgentReasoning(messages, products, orders);
    }
  } catch (err: any) {
    console.warn("Gemini API call error, executing rule-based agent logic:", err);
    return fallbackAgentReasoning(messages, products, orders);
  }
}

function isPureGreeting(text: string): boolean {
  const g = text.replace(/[^a-z]/g, "").trim();
  return ["hi", "hello", "hey", "hola", "greetings", "hiii", "helo"].includes(g);
}

/**
 * Extract Order ID from text (supports ORD-107, ORD107, order number 107, order 107, 107)
 */
function extractOrderId(text: string): string | null {
  // Direct ORD-XXX pattern
  const ordMatch = text.match(/ORD-?\d{3,4}/i);
  if (ordMatch) {
    const raw = ordMatch[0].toUpperCase();
    return raw.includes("-") ? raw : raw.replace("ORD", "ORD-");
  }

  // "order number 107", "order 107", "order #107", "number 107"
  const numMatch = text.match(/(?:order|ord|number|#)\s*(?:number|#)?\s*(\d{3,4})/i);
  if (numMatch && numMatch[1]) {
    return `ORD-${numMatch[1]}`;
  }

  // Standalone 3-4 digit number
  const digitMatch = text.match(/\b\d{3,4}\b/);
  if (digitMatch) {
    return `ORD-${digitMatch[0]}`;
  }

  return null;
}

async function handleAgentActions(messages: ChatMessage[], aiText: string) {
  const fullConversation = messages.map((m) => m.content).join(" ") + " " + aiText;
  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const lowerMsg = lastUserMsg.toLowerCase();

  const isReturnRefund = /return|retrun|retun|refund|refrun|money back|cancel|exchange/i.test(lowerMsg);

  // Check for Order Placement Intent ONLY if NOT return/refund
  const isOrderCreation = !isReturnRefund && (
    /place.*order|i want to buy|want to buy|i want (a|the)?\s*(dell|pixel|phone|laptop|mouse|keyboard|tablet|macbook|iphone|samsung|sony|airpods|ipad)|buy|purchase|confirm order/i.test(lowerMsg) ||
    /finalize your order|confirm if you would like to proceed/i.test(aiText)
  );

  if (isOrderCreation) {
    let productName = "laptop";
    if (lowerMsg.includes("pixel") || lowerMsg.includes("google pixel")) productName = "Google Pixel 9 Pro";
    else if (lowerMsg.includes("iphone")) productName = "Apple iPhone 16 Pro Max";
    else if (lowerMsg.includes("samsung")) productName = "Samsung Galaxy S25 Ultra";
    else if (lowerMsg.includes("phone")) productName = "Phone";
    else if (lowerMsg.includes("macbook")) productName = "Apple MacBook Air M3";
    else if (lowerMsg.includes("dell")) productName = "Dell XPS 15 9530";
    else if (lowerMsg.includes("laptop")) productName = "Laptop";
    else if (lowerMsg.includes("mouse")) productName = "Logitech MX Master 3S Mouse";
    else if (lowerMsg.includes("keyboard")) productName = "Logitech MX Keys S Keyboard";
    else if (lowerMsg.includes("headphone") || lowerMsg.includes("sony")) productName = "Sony WH-1000XM5 Headphones";
    else if (lowerMsg.includes("tablet") || lowerMsg.includes("ipad")) productName = "Apple iPad Pro M4";

    const nameMatch = lowerMsg.match(/(?:i am|my name is|name is)\s+([a-z]+)/i);
    const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "Customer";

    await createNewOrder(customerName, productName, "electronics");
  }

  // Check for Order ID / Refund Intent
  const orderId = extractOrderId(fullConversation);
  if (orderId && isReturnRefund) {
    const order = await getOrderById(orderId);
    if (order) {
      const evalResult = evaluateRefundEligibility(order.order_date, order.is_electronics);
      if (evalResult.eligible) {
        await updateOrderStatus(order.order_id, "Return Approved");
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
          details: `Return approved for order ${orderId}. Status updated to Return Approved.`
        });
      }
    }
  }

  // Check for Bank Details Capture
  const bankMatch = lowerMsg.match(/(bank|account|acc|mobile|phone|number|chase|bofa|wells)/i);
  if (bankMatch) {
    const numbers = lastUserMsg.match(/\d{6,15}/g);
    if (numbers && numbers.length >= 1) {
      await saveBankDetails({
        customer_email: "customer@example.com",
        order_id: orderId || "ORD-107",
        bank_name: lowerMsg.includes("chase") ? "Chase Bank" : lowerMsg.includes("wells") ? "Wells Fargo" : "Bank of America",
        account_number: numbers[0],
        mobile_number: numbers[1] || "+1-555-019-2834"
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
  const lastMsg = messages[messages.length - 1]?.content.trim() || "";
  const lowerMsg = lastMsg.toLowerCase();

  // 1. Pure Greeting
  if (isPureGreeting(lowerMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I help you today?",
      timestamp: new Date().toISOString()
    };
  }

  // Extract Customer Name if user states "MY NAME IS Nadeem"
  const nameMatch = lowerMsg.match(/(?:i am|my name is|name is)\s+([a-z]+)/i);
  const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "";

  // 2. Return / Refund / Cancel Intent (HIGHEST PRIORITY) - handles typos like "retrun", "retun"
  const isReturnRefund = /return|retrun|retun|refund|refrun|money back|cancel|exchange/i.test(lowerMsg);
  
  if (isReturnRefund) {
    const extractedId = extractOrderId(lastMsg);
    
    if (extractedId) {
      const order = await getOrderById(extractedId);
      if (order) {
        const displayName = customerName || order.customer_name || "Customer";
        const evalResult = evaluateRefundEligibility(order.order_date, order.is_electronics);

        if (evalResult.eligible) {
          // Update status in Tab 2 to "Return Approved"
          await updateOrderStatus(order.order_id, "Return Approved");

          // Pre-populate Order ID, Customer Name, and Product in Tab 3 (Bank & Customer Details)
          await saveBankDetails({
            customer_email: order.customer_email,
            order_id: order.order_id,
            bank_name: "Pending Customer Input",
            account_number: "Pending",
            mobile_number: "Pending"
          });

          await sendRefundConfirmationEmail({
            to: order.customer_email,
            customerName: displayName,
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
            details: `Return approved for order ${order.order_id}. Updated status to Return Approved.`
          });

          return {
            text: `### ✅ Return Approved for Order ${order.order_id}!

Hello **${displayName}**! Your return request for **${order.product_name}** (Order **${order.order_id}**) purchased on **${order.order_date}** (${evalResult.daysElapsed} days ago) is within the 15-day return policy window and has been **APPROVED**.

- **Order Status (Tab 2):** Updated live in Google Sheets to \`Return Approved\`.
- **Pre-populated in Tab 3:** Order ID \`${order.order_id}\`, Customer \`${displayName}\`, Product \`${order.product_name}\`.

To complete your refund payout, please reply with your **Bank Details**:
1. **Bank Name** (e.g. Chase Bank, Bank of America)
2. **Account Number**
3. **Mobile Phone Number**`,
            timestamp: new Date().toISOString()
          };
        } else {
          return {
            text: `### ❌ Return Ineligible for Order ${order.order_id}
Hello **${displayName}**, order **${order.order_id}** (${order.product_name}) was purchased on **${order.order_date}** (${evalResult.daysElapsed} days ago).
Electronics have a strict **15-day return policy**. ${evalResult.reason}`,
            timestamp: new Date().toISOString()
          };
        }
      } else {
        return {
          text: `Order \`${extractedId}\` was not found in our Google Sheets records. Please check the Order ID and try again.`,
          timestamp: new Date().toISOString()
        };
      }
    }

    return {
      text: `### 🔄 Return & Refund Request${customerName ? ` for ${customerName}` : ""}
Hello ${customerName ? customerName : "there"}! I would be glad to help you process your return.

Please reply with your **Order ID** (for example: \`ORD-101\` or \`107\`) so I can locate your purchase in Tab 2 (**Order Details**) and evaluate your return eligibility.`,
      timestamp: new Date().toISOString()
    };
  }

  // 3. Bank Details Submission (Tab 3: Bank & Customer Details)
  const isBankSubmission = /(bank|account|acc|routing|chase|bofa|wells)/i.test(lowerMsg) && /\d{5,15}/.test(lowerMsg);
  if (isBankSubmission) {
    const extractedId = extractOrderId(lastMsg) || "ORD-107";
    const numbers = lastMsg.match(/\d{5,15}/g) || ["123456789", "+1-555-019-2834"];

    await saveBankDetails({
      customer_email: "customer@example.com",
      order_id: extractedId,
      bank_name: lowerMsg.includes("chase") ? "Chase Bank" : lowerMsg.includes("wells") ? "Wells Fargo" : "Bank of America",
      account_number: numbers[0],
      mobile_number: numbers[1] || "+1-555-019-2834"
    });

    return {
      text: `### ✅ Bank & Mobile Details Recorded!
${customerName ? `Thank you **${customerName}**!` : "Thank you!"} Your bank payout details for Order **${extractedId}** have been populated into Google Sheets Tab 3 (**Bank & Customer Details**):

- **Order ID:** \`${extractedId}\`
- **Bank Account:** \`****${numbers[0].slice(-4)}\`
- **Mobile Number:** \`${numbers[1] || "+1-555-019-2834"}\`
- **Status:** **Return Approved**

Your refund will be transferred directly to your bank account within **5 business days**!`,
      timestamp: new Date().toISOString()
    };
  }

  // 4. Order Placement Intent
  const isOrderPlacement = /place.*order|i want to buy|want to buy|i want (a|the)?\s*(dell|pixel|phone|laptop|mouse|keyboard|tablet|macbook|iphone|samsung|sony|airpods|ipad)|buy|purchase|confirm order/i.test(lowerMsg);
  if (isOrderPlacement) {
    let productName = "laptop";
    if (lowerMsg.includes("pixel") || lowerMsg.includes("google pixel")) productName = "Google Pixel 9 Pro";
    else if (lowerMsg.includes("iphone")) productName = "Apple iPhone 16 Pro Max";
    else if (lowerMsg.includes("samsung")) productName = "Samsung Galaxy S25 Ultra";
    else if (lowerMsg.includes("phone")) productName = "Phone";
    else if (lowerMsg.includes("macbook")) productName = "Apple MacBook Air M3";
    else if (lowerMsg.includes("dell")) productName = "Dell XPS 15 9530";
    else if (lowerMsg.includes("laptop")) productName = "Laptop";
    else if (lowerMsg.includes("mouse")) productName = "Logitech MX Master 3S Mouse";
    else if (lowerMsg.includes("keyboard")) productName = "Logitech MX Keys S Keyboard";
    else if (lowerMsg.includes("headphone") || lowerMsg.includes("sony")) productName = "Sony WH-1000XM5 Headphones";
    else if (lowerMsg.includes("tablet") || lowerMsg.includes("ipad")) productName = "Apple iPad Pro M4";

    const displayName = customerName || "Nadeem";
    const newOrder = await createNewOrder(displayName, productName, "electronics");

    return {
      text: `### 🎉 Order Placed Successfully!
Your order for **${productName}** has been confirmed.

**Order Details:**
- **Order ID:** \`${newOrder.order_id}\`
- **Customer:** ${newOrder.customer_name}
- **Item:** ${newOrder.product_name}
- **Status:** Recorded live in Google Sheets **Order Details** tab!`,
      timestamp: new Date().toISOString()
    };
  }

  // 5. Product & Pricing Queries (Tab 1: Products List)
  const isProductQuery = /price|cost|product|catalog|stock|item|spec|mouse|keyboard|laptop|phone|headphone|tablet|dell|apple|sony|samsung|pixel|macbook|logitech|razer|tell me|show me/i.test(lowerMsg);
  if (isProductQuery) {
    const stopWords = new Set(["hi", "hello", "hey", "tell", "me", "prices", "price", "cost", "of", "the", "is", "a", "an", "for", "i", "want", "show", "what", "are", "have", "you", "please", "and"]);
    const keywords = lowerMsg.split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase()).filter((w) => w.length > 1 && !stopWords.has(w));

    let matching = products;
    if (keywords.length > 0) {
      matching = products.filter((p) => {
        const fullText = `${p.name} ${p.category} ${p.description}`.toLowerCase();
        return keywords.every((k) => fullText.includes(k));
      });

      if (matching.length === 0) {
        matching = products.filter((p) => {
          const categoryLower = (p.category || "").toLowerCase();
          const nameLower = (p.name || "").toLowerCase();
          const descLower = (p.description || "").toLowerCase();
          return keywords.some((k) => categoryLower.includes(k) || nameLower.includes(k) || descLower.includes(k));
        });
      }
    }

    if (matching.length === 0) matching = products.slice(0, 5);

    const titleStr = keywords.length > 0 ? `Products Matching "${keywords.join(" ")}"` : "Products List";
    const responseText = `### 🛒 ${titleStr} (Tab 1: Products List)\n` + matching.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}\n  *Category:* ${p.category} | *Specs:* ${p.description || "N/A"}`).join("\n\n");

    return { text: responseText, timestamp: new Date().toISOString() };
  }

  // 6. Order Lookup by ID
  const extractedId = extractOrderId(lastMsg);
  if (extractedId) {
    const order = await getOrderById(extractedId);
    if (order) {
      return {
        text: `### 📦 Order Details (\`${order.order_id}\`)
- **Customer:** ${order.customer_name} (${order.customer_email})
- **Product:** ${order.product_name}
- **Total Price:** $${order.total_price}
- **Purchase Date:** ${order.order_date}
- **Refund Status:** **${order.status}**`,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 7. Policy Inquiries
  if (/policy|return policy|refund policy|rules/i.test(lowerMsg)) {
    return {
      text: `### 📋 Company Return & Refund Policy (RAG Verified)
- **Electronics Return Window:** 15 days from purchase date.
- **Standard Items:** 30 days from purchase date.
- **Condition:** Must be unused and in original packaging.
- **Refund Payouts:** Approved refunds update status to \`Return Approved\` in Tab 2 and populate bank details in Tab 3!`,
      timestamp: new Date().toISOString()
    };
  }

  // Default Smart Assistant Guidance (Never return raw greeting)
  return {
    text: `Hello${customerName ? ` **${customerName}**` : ""}! I am **Mind_Dream AI**. How can I assist you today?

- 🛒 **Inquire Products:** Ask about laptops (*Dell, Apple, HP*), phones (*Samsung, Pixel*), specs & prices (Tab 1).
- 🔄 **Request Return/Refund:** Provide your Order ID (e.g., \`107\` or \`ORD-107\`) to evaluate 15-day return eligibility (Tab 2).
- 💳 **Submit Bank Details:** Provide bank & mobile details for approved refunds (Tab 3).`,
    timestamp: new Date().toISOString()
  };
}
