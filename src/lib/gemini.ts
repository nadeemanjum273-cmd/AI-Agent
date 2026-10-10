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

  if (isPureGreeting(lowerUserMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I assist you today?",
      timestamp: new Date().toISOString()
    };
  }

  const systemInstruction = `
You are Mind_Dream AI, an AI Customer & Sales Support Agent.
Your goal is to provide concise, accurate, and direct assistance based strictly on company databases, Google Sheets, and policy documents.

STRICT OPERATIONAL RULES:

1. GREETINGS:
   - If the user ONLY greets (e.g. "Hi", "Hello"), reply ONLY with: "Hello! I am Mind_Dream AI. How can I assist you today?"

2. PRODUCT & PRICING QUERIES (Tab 1: Products List):
   - When asked for product prices, specs, models, or recommendations (e.g., "tell me laptop dell", "price of Samsung S25"), query the Products List sheet (Tab 1) and return exact specs, stock, and price.

3. REFUND & RETURN WORKFLOW (Tab 2: Order Details & Tab 3: Bank & Customer Details):
   - STEP 1: Identify Order ID (e.g. ORD-107, 107, order number 107) and Customer Name.
   - STEP 2: Electronics have a 15-day return policy; standard items have 30 days.
   - STEP 3: Calculate purchase date vs current date. If within policy limit (< 15 days), declare Eligible and update status in Tab 2 to "Return Approved".
   - STEP 4: Request Bank Name, Account Number, and Mobile Number from customer. DO NOT populate Tab 3 until ALL THREE essential details (Bank Name, Account Number, Mobile Number) are provided by the customer.
   - STEP 5: Once all 3 essential details are provided, populate them into Tab 3 (Bank & Customer Details) following Row 2 pattern: Order ID, Customer Name, Product, Bank Name, Account Number, Mobile Number.
`;

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

function extractOrderId(text: string): string | null {
  const ordMatch = text.match(/ORD-?\d{3,4}/i);
  if (ordMatch) {
    const raw = ordMatch[0].toUpperCase();
    return raw.includes("-") ? raw : raw.replace("ORD", "ORD-");
  }

  const numMatch = text.match(/(?:order|ord|number|#)\s*(?:number|#)?\s*(\d{3,4})/i);
  if (numMatch && numMatch[1]) {
    return `ORD-${numMatch[1]}`;
  }

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

  const fullText = messages.map((m) => m.content).join(" ") + " " + lastUserMsg;
  const lowerFull = fullText.toLowerCase();

  let bankName: string = "";
  if (/meezan/i.test(lowerFull)) bankName = "Meezan Bank";
  else if (/hbl|habib bank/i.test(lowerFull)) bankName = "HBL Bank";
  else if (/ubl|united bank/i.test(lowerFull)) bankName = "UBL Bank";
  else if (/mcb/i.test(lowerFull)) bankName = "MCB Bank";
  else if (/chase/i.test(lowerFull)) bankName = "Chase Bank";
  else if (/bofa|bank of america/i.test(lowerFull)) bankName = "Bank of America";
  else if (/wells/i.test(lowerFull)) bankName = "Wells Fargo";
  else if (/allied|abl/i.test(lowerFull)) bankName = "Allied Bank";
  else if (/alfalah/i.test(lowerFull)) bankName = "Bank Alfalah";
  else if (/faysal/i.test(lowerFull)) bankName = "Faysal Bank";
  else if (/askari/i.test(lowerFull)) bankName = "Askari Bank";
  else if (/citi/i.test(lowerFull)) bankName = "Citibank";
  else {
    const customBank = lastUserMsg.match(/(?:bank name|bank)[\s:]*([a-zA-Z\s]+?)(?:,|$|\n|account|acc|mobile|phone)/i);
    if (customBank && customBank[1] && (customBank[1] || "").trim().length > 2) {
      const b = (customBank[1] || "").trim();
      bankName = b.toLowerCase().includes("bank") ? b : (b + " Bank");
    } else if (/\bbank\b/i.test(lowerMsg)) {
      bankName = "Bank";
    }
  }

  const numbers = fullText.match(/\b\d{6,16}\b/g) || [];
  let accountNumber: string | null = null;
  let mobileNumber: string | null = null;

  for (const num of numbers) {
    if ((num.startsWith("3") || num.startsWith("03") || num.length === 10 || num.length === 11) && !mobileNumber) {
      mobileNumber = num;
    } else if (!accountNumber) {
      accountNumber = num;
    }
  }
  if (!accountNumber && numbers.length > 0) accountNumber = numbers[0] || null;
  if (!mobileNumber && numbers.length > 1) mobileNumber = numbers[1] || null;

  const isComplete = Boolean(bankName.length > 0 && accountNumber && mobileNumber);
  if (isComplete) {
    const targetOrderId = orderId || "ORD-103";
    const order = await getOrderById(targetOrderId);
    const customerName = order?.customer_name || "John";
    const productName = order?.product_name || "phone";

    await saveBankDetails({
      order_id: targetOrderId,
      customer_name: customerName,
      product: productName,
      bank_name: bankName || "Bank",
      account_number: accountNumber || "N/A",
      mobile_number: mobileNumber || "N/A"
    });
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

  if (isPureGreeting(lowerMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I assist you today?",
      timestamp: new Date().toISOString()
    };
  }

  const nameMatch = lowerMsg.match(/(?:i am|my name is|name is)\s+([a-z]+)/i);
  const customerName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : "";

  const isReturnRefund = /return|retrun|retun|refund|refrun|money back|cancel|exchange/i.test(lowerMsg);
  if (isReturnRefund) {
    const extractedId = extractOrderId(lastMsg);
    
    if (extractedId) {
      const order = await getOrderById(extractedId);
      if (order) {
        const displayName = customerName || order.customer_name || "John";
        const evalResult = evaluateRefundEligibility(order.order_date, order.is_electronics);

        if (evalResult.eligible) {
          await updateOrderStatus(order.order_id, "Return Approved");

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

- **Order Status (Tab 2):** Updated live in Google Sheets to "Return Approved".

To complete your refund payout, please reply with your **Bank Details**:
1. **Bank Name** (e.g. Meezan Bank, HBL Bank, Chase)
2. **Account Number** (e.g. 9876543210)
3. **Mobile Phone Number** (e.g. 3009876543)

*Note: According to store policy, all 3 essential details must be provided to populate Tab 3 (Bank & Customer Details).* `,
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

Please reply with your **Order ID** (for example: "ORD-103" or "107") so I can locate your purchase in Tab 2 (**Order Details**) and evaluate your return eligibility.`,
      timestamp: new Date().toISOString()
    };
  }

  const bankMatch = /(bank|account|acc|mobile|phone|number|meezan|hbl|ubl|mcb|chase|bofa|wells|allied|alfalah|faysal|askari|citi)/i.test(lowerMsg);
  if (bankMatch) {
    const fullText = messages.map((m) => m.content).join(" ") + " " + lastMsg;
    const lowerFull = fullText.toLowerCase();

    let bankName: string = "";
    if (/meezan/i.test(lowerFull)) bankName = "Meezan Bank";
    else if (/hbl|habib bank/i.test(lowerFull)) bankName = "HBL Bank";
    else if (/ubl|united bank/i.test(lowerFull)) bankName = "UBL Bank";
    else if (/mcb/i.test(lowerFull)) bankName = "MCB Bank";
    else if (/chase/i.test(lowerFull)) bankName = "Chase Bank";
    else if (/bofa|bank of america/i.test(lowerFull)) bankName = "Bank of America";
    else if (/wells/i.test(lowerFull)) bankName = "Wells Fargo";
    else if (/allied|abl/i.test(lowerFull)) bankName = "Allied Bank";
    else if (/alfalah/i.test(lowerFull)) bankName = "Bank Alfalah";
    else if (/faysal/i.test(lowerFull)) bankName = "Faysal Bank";
    else if (/askari/i.test(lowerFull)) bankName = "Askari Bank";
    else if (/citi/i.test(lowerFull)) bankName = "Citibank";
    else {
      const customBank = lastMsg.match(/(?:bank name|bank)[\s:]*([a-zA-Z\s]+?)(?:,|$|\n|account|acc|mobile|phone)/i);
      if (customBank && customBank[1] && (customBank[1] || "").trim().length > 2) {
        const b = (customBank[1] || "").trim();
        bankName = b.toLowerCase().includes("bank") ? b : (b + " Bank");
      } else if (/\bbank\b/i.test(lowerMsg)) {
        bankName = "Bank";
      }
    }

    const numbers = fullText.match(/\b\d{6,16}\b/g) || [];
    let accountNumber: string | null = null;
    let mobileNumber: string | null = null;

    for (const num of numbers) {
      if ((num.startsWith("3") || num.startsWith("03") || num.length === 10 || num.length === 11) && !mobileNumber) {
        mobileNumber = num;
      } else if (!accountNumber) {
        accountNumber = num;
      }
    }
    if (!accountNumber && numbers.length > 0) accountNumber = numbers[0] || null;
    if (!mobileNumber && numbers.length > 1) mobileNumber = numbers[1] || null;

    const isComplete = Boolean(bankName.length > 0 && accountNumber && mobileNumber);
    const extractedId = extractOrderId(fullText) || "ORD-103";
    const order = await getOrderById(extractedId);
    const displayName = customerName || order?.customer_name || "John";
    const productName = order?.product_name || "phone";

    if (isComplete) {
      await saveBankDetails({
        order_id: extractedId,
        customer_name: displayName,
        product: productName,
        bank_name: bankName || "Bank",
        account_number: accountNumber || "N/A",
        mobile_number: mobileNumber || "N/A"
      });

      return {
        text: `### ✅ Bank Details Recorded in Google Sheets Tab 3!
Thank you **${displayName}**! Your complete bank payout details for Order **${extractedId}** (${productName}) have been saved to Google Sheets Tab 3 (**Bank & Customer Details**) matching Row 2 pattern:

- **order_id:** \`${extractedId}\`
- **customer:** \`${displayName}\`
- **product:** \`${productName}\`
- **Bank_Name:** \`${bankName}\`
- **Account Number:** \`${accountNumber}\`
- **Mobile Number:** \`${mobileNumber}\`

Your refund payout will be processed directly to your bank account within **3-5 business days**!`,
        timestamp: new Date().toISOString()
      };
    } else {
      const bStatus = bankName ? bankName + " ✅" : "❌ Missing";
      const aStatus = accountNumber ? accountNumber + " ✅" : "❌ Missing";
      const mStatus = mobileNumber ? mobileNumber + " ✅" : "❌ Missing";

      return {
        text: `### ⚠️ Essential Bank Details Required
To record your refund in Tab 3 of Google Sheets, please provide all **3 essential details**:

- 🏦 **Bank Name:** ${bStatus}
- 🔢 **Account Number:** ${aStatus}
- 📱 **Mobile Number:** ${mStatus}

Please reply with the missing essential detail(s) so we can save your complete information and process your payout!`,
        timestamp: new Date().toISOString()
      };
    }
  }

  const isOrderPlacement = /place.*order|i want to buy|want to buy|i want (a|the)?\\s*(dell|pixel|phone|laptop|mouse|keyboard|tablet|macbook|iphone|samsung|sony|airpods|ipad)|buy|purchase|confirm order/i.test(lowerMsg);
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

    const displayName = customerName || "John";
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

  const isProductQuery = /price|cost|product|catalog|stock|item|spec|mouse|keyboard|laptop|phone|headphone|tablet|dell|apple|sony|samsung|pixel|macbook|logitech|razer|tell me|show me/i.test(lowerMsg);
  if (isProductQuery) {
    const stopWords = new Set(["hi", "hello", "hey", "tell", "me", "prices", "price", "cost", "of", "the", "is", "a", "an", "for", "i", "want", "show", "what", "are", "have", "you", "please", "and"]);
    const keywords = lowerMsg.split(/[\\s,]+/).map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase()).filter((w) => w.length > 1 && !stopWords.has(w));

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
    const responseText = `### 🛒 ${titleStr} (Tab 1: Products List)\\n` + matching.map((p) => `- **${p.name}** (\`${p.id}\`): **$${p.price}** | Stock: ${p.stock}\\n  *Category:* ${p.category} | *Specs:* ${p.description || "N/A"}`).join("\n\n");

    return { text: responseText, timestamp: new Date().toISOString() };
  }

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

  if (/policy|return policy|refund policy|rules/i.test(lowerMsg)) {
    return {
      text: `### 📋 Company Return & Refund Policy (RAG Verified)
- **Electronics Return Window:** 15 days from purchase date.
- **Standard Items:** 30 days from purchase date.
- **Condition:** Must be unused and in original packaging.
- **Refund Payouts:** Approved refunds update status to "Return Approved" in Tab 2 and populate bank details in Tab 3 upon completing all 3 essential fields!`,
      timestamp: new Date().toISOString()
    };
  }

  return {
    text: `Hello${customerName ? ` **${customerName}**` : ""}! I am **Mind_Dream AI**. How can I assist you today?

- 🛒 **Inquire Products:** Ask about laptops (*Dell, Apple, HP*), phones (*Samsung, Pixel*), specs & prices (Tab 1).
- 🔄 **Request Return/Refund:** Provide your Order ID (e.g., \`103\` or "ORD-103") to evaluate 15-day return eligibility (Tab 2).
- 💳 **Submit Bank Details:** Provide bank name, account number & mobile number for approved refunds (Tab 3).`,
    timestamp: new Date().toISOString()
  };
}
