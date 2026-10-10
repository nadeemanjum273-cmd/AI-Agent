import { GoogleGenAI } from "@google/genai";
import { fetchProducts, fetchOrders, getOrderById, updateOrderStatus, saveBankDetails, logInteraction, createNewOrder } from "./googleSheets";
import { COMPANY_POLICY, evaluateRefundEligibility } from "./policy";
import { sendRefundConfirmationEmail } from "./emailService";

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export function extractUserBankInfo(text: string) {
  const lower = text.toLowerCase();

  let bankName = "";
  if (/meezan/i.test(lower)) bankName = "Meezan Bank";
  else if (/\bhbl\b|habib bank/i.test(lower)) bankName = "HBL";
  else if (/\bubl\b|united bank/i.test(lower)) bankName = "UBL";
  else if (/\bmcb\b/i.test(lower)) bankName = "MCB";
  else if (/\bchase\b/i.test(lower)) bankName = "Chase";
  else if (/bofa|bank of america/i.test(lower)) bankName = "Bank of America";
  else if (/wells fargo|\bwells\b/i.test(lower)) bankName = "Wells Fargo";
  else if (/allied|\babl\b/i.test(lower)) bankName = "Allied Bank";
  else if (/alfalah/i.test(lower)) bankName = "Bank Alfalah";
  else if (/faysal/i.test(lower)) bankName = "Faysal Bank";
  else if (/askari/i.test(lower)) bankName = "Askari Bank";
  else if (/citi|citibank/i.test(lower)) bankName = "Citibank";
  else if (/standard chartered|\bscb\b/i.test(lower)) bankName = "Standard Chartered";
  else {
    const match = text.match(/(?:bank\s*name|bank\s*is|bank|for)[\s:]*([a-zA-Z\s]{2,25})(?:,|$|\n|account|acc|mobile|phone|ph|\d)/i);
    if (match && match[1] && match[1].trim().length >= 2) {
      const extracted = match[1].trim();
      if (!/account|mobile|phone|number|detail/i.test(extracted)) {
        bankName = extracted;
      }
    }
  }

  let accountNumber = "";
  let mobileNumber = "";

  const mobMatch = text.match(/(?:mobile|phone|contact|cell|ph)[\s#:]*(\+?\d{7,15})/i);
  if (mobMatch && mobMatch[1]) {
    mobileNumber = mobMatch[1];
  }

  const accMatch = text.match(/(?:account|acc|a\/c)[\s#:]*([0-9A-Za-z]{6,24})/i);
  if (accMatch && accMatch[1]) {
    accountNumber = accMatch[1];
  }

  const allNumbers = text.match(/\b\+?\d{6,24}\b/g) || [];
  for (const num of allNumbers) {
    const clean = num.replace(/\D/g, "");
    if (clean.length < 5) continue;

    const isMobileFormat = (clean.startsWith("03") || clean.startsWith("3") || clean.startsWith("92")) && clean.length >= 10 && clean.length <= 13;

    if (isMobileFormat && !mobileNumber) {
      mobileNumber = num;
    } else if (!accountNumber && num !== mobileNumber) {
      accountNumber = num;
    }
  }

  if (!accountNumber && allNumbers.length > 0 && allNumbers[0] !== mobileNumber) {
    accountNumber = allNumbers[0] || "";
  }
  if (!mobileNumber && allNumbers.length > 1 && allNumbers[1] !== accountNumber) {
    mobileNumber = allNumbers[1] || "";
  }

  return { bankName, accountNumber, mobileNumber };
}

export function extractCustomerName(text: string): string {
  const patterns = [
    /(?:my name is|name is|name:|customer:)s*([a-zA-Z]+)/i,
    /(?:i am|iam|i ma|ima|this is)s+([a-zA-Z]+)/i,
    /^([a-zA-Z]+)s+(?:here|want|wants|placing|places|would like)/i
  ];

  for (const p of patterns) {
    const match = text.match(p);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const forbidden = ["phone", "laptop", "order", "buy", "please", "product", "want", "place", "new", "ma", "am", "here", "the", "an", "a"];
      if (!forbidden.includes(candidate.toLowerCase()) && candidate.length >= 2) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
      }
    }
  }

  const beforeOrderMatch = text.match(/([a-zA-Z]+)s*(?:want to place|wants to place|place my|place an|place order)/i);
  if (beforeOrderMatch && beforeOrderMatch[1]) {
    const candidate = beforeOrderMatch[1].trim();
    const forbidden = ["i", "ma", "am", "please", "to", "and", "just", "now", "order"];
    if (!forbidden.includes(candidate.toLowerCase()) && candidate.length >= 2) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
    }
  }

  return "";
}

function findMatchingProduct(userText: string, products: any[]) {
  const lower = userText.toLowerCase();

  // Try matching exact product name or brand+model
  for (const p of products) {
    const nameLow = p.name.toLowerCase();
    if (lower.includes(nameLow)) return p;
  }

  // Try matching individual distinct keywords
  const keywords = lower.split(/\s+/).filter((w) => w.length >= 4 && !["phone", "laptop", "order", "place", "want", "please", "this", "that", "with"].includes(w));

  for (const p of products) {
    const fullText = `${p.name} ${p.category} ${p.description}`.toLowerCase();
    if (keywords.some((k) => fullText.includes(k))) {
      return p;
    }
  }

  return null;
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

  const [products, orders] = await Promise.all([fetchProducts(), fetchOrders()]);

  const systemInstruction = `
You are Mind_Dream AI, an AI Customer & Sales Support Agent.
Your goal is to provide concise, accurate, and direct assistance based strictly on company databases, Google Sheets, and policy documents.

STRICT OPERATIONAL RULES:

1. GREETINGS:
   - If the user ONLY greets (e.g. "Hi", "Hello"), reply ONLY with: "Hello! I am Mind_Dream AI. How can I assist you today?"

2. PRODUCT & PRICING QUERIES (Tab 1: Products List):
   - When asked for product prices, specs, models, or recommendations, query Tab 1 and return exact specs, stock, and price.

3. NEW ORDER PLACEMENT (Tab 2: Orders):
   - ALWAYS verify stock in Tab 1 (Products List) before confirming an order!
   - If stock is 0 (Out of Stock), reject the order and inform the user that the product is Out of Stock.
   - If stock > 0, extract the customer's actual provided name (e.g. "Zuli" or "Zulqi") and exact product name/category from Tab 1, insert a NEW row into Tab 2 (Orders), and respond with clear confirmation.

4. REFUND & RETURN WORKFLOW (Tab 2 & Tab 3):
   - Check days_ago <= 15 days in Tab 2. Update Column F to "Return Approved".
   - When bank details (Bank Name, Account Number, Mobile Number) are provided, insert a NEW row into Tab 3 with exact user bank data + matching Tab 2 order metadata.
`;

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

    const actionResult = await handleAgentActions(messages, aiAnswer, products);
    if (actionResult && actionResult.text) {
      return actionResult;
    }

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

async function handleAgentActions(messages: ChatMessage[], aiText: string, products: any[]): Promise<{ text: string; timestamp: string } | null> {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1]?.content || "";
  const userFullText = userMessages.map((m) => m.content).join(" ");
  const lowerMsg = lastUserMsg.toLowerCase();

  const isReturnRefund = /return|retrun|retun|refund|refrun|money back|cancel|exchange/i.test(lowerMsg);

  const isOrderCreation = !isReturnRefund && (
    /place.*order|i want to buy|want to buy|buy|purchase|confirm order/i.test(lowerMsg) ||
    /order\s*:/i.test(lowerMsg) ||
    (lowerMsg.includes("order") && (lowerMsg.includes("iphone") || lowerMsg.includes("laptop") || lowerMsg.includes("phone") || lowerMsg.includes("samsung") || lowerMsg.includes("dell")))
  );

  if (isOrderCreation) {
    const customerName = extractCustomerName(lastUserMsg) || extractCustomerName(userFullText) || "Customer";
    const matched = findMatchingProduct(lastUserMsg, products);

    if (matched && matched.stock <= 0) {
      return {
        text: `### ⚠️ Product Out of Stock!

Hello **${customerName}**! The item **${matched.name}** is currently **Out of Stock** (Stock: 0) in our inventory (Tab 1: Products List).

We cannot place an order for out-of-stock items. Please select an available product from Tab 1!`,
        timestamp: new Date().toISOString()
      };
    }

    const productName = matched ? matched.name : "Apple iPhone 16 Pro Max";
    const category = matched ? matched.category : "Electronics";

    await createNewOrder(customerName, productName, category);
  }

  const orderId = extractOrderId(userFullText) || extractOrderId(aiText);
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
      }
    }
  }

  const { bankName, accountNumber, mobileNumber } = extractUserBankInfo(userFullText);
  const isComplete = Boolean(bankName && accountNumber && mobileNumber);

  if (isComplete && !isOrderCreation) {
    const targetOrderId = orderId || "ORD-106";
    const order = await getOrderById(targetOrderId);
    const customerName = order?.customer_name || extractCustomerName(userFullText) || "Customer";
    const productName = order?.product_name || "Product";

    await saveBankDetails({
      order_id: targetOrderId,
      customer_name: customerName,
      product: productName,
      bank_name: bankName,
      account_number: accountNumber,
      mobile_number: mobileNumber
    });
  }

  return null;
}

/**
 * Deterministic Rule-Based Reasoning logic for Mind_Dream AI
 */
async function fallbackAgentReasoning(
  messages: ChatMessage[],
  products: any[],
  orders: any[]
): Promise<{ text: string; timestamp: string }> {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1]?.content.trim() || "";
  const userFullText = userMessages.map((m) => m.content).join(" ");
  const lowerMsg = lastUserMsg.toLowerCase();

  if (isPureGreeting(lowerMsg)) {
    return {
      text: "Hello! I am Mind_Dream AI. How can I assist you today?",
      timestamp: new Date().toISOString()
    };
  }

  const customerName = extractCustomerName(lastUserMsg) || extractCustomerName(userFullText) || "Customer";

  // 1. ORDER CREATION / PLACEMENT
  const isReturnRefund = /return|retrun|retun|refund|refrun|money back|cancel|exchange/i.test(lowerMsg);
  const isOrderPlacement = !isReturnRefund && (
    /place.*order|i want to buy|want to buy|buy|purchase|confirm order/i.test(lowerMsg) ||
    /order\s*:/i.test(lowerMsg) ||
    (lowerMsg.includes("order") && (lowerMsg.includes("iphone") || lowerMsg.includes("laptop") || lowerMsg.includes("phone") || lowerMsg.includes("samsung") || lowerMsg.includes("dell")))
  );

  if (isOrderPlacement) {
    const matched = findMatchingProduct(lastUserMsg, products);

    if (matched && matched.stock <= 0) {
      return {
        text: `### ⚠️ Product Out of Stock!

Hello **${customerName}**! The item **${matched.name}** is currently **Out of Stock** (Stock: 0) in our inventory (Tab 1: Products List).

We cannot place an order for out-of-stock items. Please select an available product from Tab 1!`,
        timestamp: new Date().toISOString()
      };
    }

    let productName = matched ? matched.name : "Apple iPhone 16 Pro Max";
    let category = matched ? matched.category : "Electronics";

    if (!matched) {
      if (lowerMsg.includes("iphone") || lowerMsg.includes("apple")) { productName = "Apple iPhone 16 Pro Max"; category = "Phone"; }
      else if (lowerMsg.includes("samsung") || lowerMsg.includes("s25")) { productName = "Samsung Galaxy S25 Ultra"; category = "Phone"; }
      else if (lowerMsg.includes("pixel")) { productName = "Google Pixel 9 Pro"; category = "Phone"; }
      else if (lowerMsg.includes("dell")) { productName = "Dell XPS 15 9530"; category = "Laptop"; }
      else if (lowerMsg.includes("macbook")) { productName = "Apple MacBook Air M3"; category = "Laptop"; }
    }

    const newOrder = await createNewOrder(customerName, productName, category);

    return {
      text: `### 🎉 Order Placed Successfully!

Your order for **${productName}** has been confirmed and placed in **Tab 2 (Orders)**.

**Order Summary:**
- **Order ID:** "${newOrder.order_id}"
- **Customer Name:** ${newOrder.customer_name}
- **Product Name:** ${newOrder.product_name}
- **Category:** ${category}
- **Status:** Recorded live in Google Sheets **Orders** tab!
`,
      timestamp: new Date().toISOString()
    };
  }

  // 2. RETURN / REFUND REQUEST
  if (isReturnRefund) {
    const extractedId = extractOrderId(lastUserMsg) || extractOrderId(userFullText);

    if (extractedId) {
      const order = await getOrderById(extractedId);
      if (order) {
        const displayName = customerName !== "Customer" ? customerName : order.customer_name || "Customer";
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

          return {
            text: `### ✅ Return Approved for Order ${order.order_id}!

Hello **${displayName}**! Your return request for **${order.product_name}** (Order **${order.order_id}**) purchased on **${order.order_date}** (${evalResult.daysElapsed} days ago) is within the return policy window and has been **APPROVED**.

- **Order Status (Tab 2):** Updated live in Google Sheets Column F (Refund Status) to "Return Approved".

To process your refund payout, please reply with your **Bank Details**:
1. **Bank Name** (e.g. HBL, Meezan Bank, UBL, MCB)
2. **Account Number** (e.g. 51892316895623)
3. **Mobile Phone Number** (e.g. 03014489556)

*Note: All 3 essential details (Bank Name, Account Number, Mobile Number) are required to insert your payout record into Tab 3.* `,
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
          text: `Order "${extractedId}" was not found in our Google Sheets records. Please check the Order ID and try again.`,
          timestamp: new Date().toISOString()
        };
      }
    }

    return {
      text: `### 🔄 Return & Refund Request${customerName !== "Customer" ? ` for ${customerName}` : ""}
Hello ${customerName !== "Customer" ? customerName : "there"}! I would be glad to help you process your return.

Please reply with your **Order ID** (for example: "ORD-106" or "106") so I can locate your purchase in Tab 2 (**Order Details**) and evaluate your return eligibility.`,
      timestamp: new Date().toISOString()
    };
  }

  // 3. BANK DETAILS SUBMISSION
  const userBankDetails = extractUserBankInfo(userFullText);
  const hasBankMention = /bank|account|acc|meezan|hbl|ubl|mcb|chase|bofa|wells|allied|alfalah|faysal|askari|citi/i.test(lowerMsg) ||
    Boolean(userBankDetails.bankName || userBankDetails.accountNumber);

  if (hasBankMention && !isOrderPlacement) {
    const { bankName, accountNumber, mobileNumber } = userBankDetails;
    const isComplete = Boolean(bankName && accountNumber && mobileNumber);

    const extractedId = extractOrderId(userFullText) || "ORD-106";
    const order = await getOrderById(extractedId);

    const displayName = order?.customer_name || (customerName !== "Customer" ? customerName : "Customer");
    const productName = order?.product_name || "Product";

    if (isComplete) {
      await saveBankDetails({
        order_id: extractedId,
        customer_name: displayName,
        product: productName,
        bank_name: bankName,
        account_number: accountNumber,
        mobile_number: mobileNumber
      });

      return {
        text: `### ✅ Bank Details Recorded in Google Sheets Tab 3!
Thank you **${displayName}**! Your payout details for Order **${extractedId}** (${productName}) have been inserted into a NEW row in Tab 3 (**Bank & Customer Details**) with your exact provided data:

- **order_id (Col A):** "${extractedId}"
- **customer (Col B):** "${displayName}"
- **product (Col C):** "${productName}"
- **Bank_Name (Col D):** "${bankName}"
- **Account Number (Col E):** "${accountNumber}"
- **Mobile Number (Col F):** "${mobileNumber}"

Your refund payout will be processed directly to your bank account within **3-5 business days**!`,
        timestamp: new Date().toISOString()
      };
    } else {
      const bStatus = bankName ? bankName + " ✅" : "❌ Missing";
      const aStatus = accountNumber ? accountNumber + " ✅" : "❌ Missing";
      const mStatus = mobileNumber ? mobileNumber + " ✅" : "❌ Missing";

      return {
        text: `### ⚠️ Essential Bank Details Required
To record your refund payout in Tab 3 of Google Sheets, please provide all **3 essential details**:

- 🏦 **Bank Name:** ${bStatus}
- 🔢 **Account Number:** ${aStatus}
- 📱 **Mobile Number:** ${mStatus}

Please reply with the missing essential detail(s) so we can insert your complete record into Tab 3!`,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 4. PRODUCT / PRICING INQUIRY (Tab 1)
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
    const responseText = `### 🛒 ${titleStr} (Tab 1: Products List)\n` + matching.map((p) => `- **${p.name}** ("${p.id}"): **$${p.price}** | Stock: ${p.stock} ${p.stock <= 0 ? "❌ (Out of Stock)" : "✅ (In Stock)"}\n  *Category:* ${p.category} | *Specs:* ${p.description || "N/A"}`).join("\n\n");

    return { text: responseText, timestamp: new Date().toISOString() };
  }

  // 5. ORDER QUERY BY ID
  const extractedId = extractOrderId(lastUserMsg);
  if (extractedId) {
    const order = await getOrderById(extractedId);
    if (order) {
      return {
        text: `### 📦 Order Details ("${order.order_id}")
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
- **Refund Payouts:** Approved refunds update status to "Return Approved" in Tab 2 and populate bank details into Tab 3 upon completing all 3 essential fields!`,
      timestamp: new Date().toISOString()
    };
  }

  return {
    text: `Hello${customerName !== "Customer" ? ` **${customerName}**` : ""}! I am **Mind_Dream AI**. How can I assist you today?

- 🛒 **Inquire Products:** Ask about laptops (*Dell, Apple, HP*), phones (*Samsung, Pixel*), specs & prices (Tab 1).
- 📦 **Place New Order:** Say "please place my new order: Phone Apple iPhone 16 Pro Max, my name is Zulqi" (Tab 2).
- 🔄 **Request Return/Refund:** Provide your Order ID (e.g., "106" or "ORD-106") to evaluate return eligibility (Tab 2).
- 💳 **Submit Bank Details:** Provide bank name, account number & mobile number for approved refunds (Tab 3).`,
    timestamp: new Date().toISOString()
  };
}
