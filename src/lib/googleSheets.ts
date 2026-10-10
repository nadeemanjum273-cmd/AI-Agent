import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { Product, Order, InteractionLog, GOOGLE_SHEET_URL } from "./types";

export type { Product, Order, InteractionLog };
export { GOOGLE_SHEET_URL };

export interface BankDetails {
  order_id: string;
  customer_name: string;
  product: string;
  bank_name: string;
  account_number: string;
  mobile_number: string;
}

let memoryProducts: Product[] = [];
let memoryOrders: Order[] = [];
let memoryLogs: InteractionLog[] = [];
let memoryBankDetails: BankDetails[] = [];

export const SHEET_ID = "1JeGY2xGqj-GQABEZlPrfvso8L9ukQLGgPgPqsFUfOuA";

const DEFAULT_CLIENT_EMAIL = "nadeemanjum@kinetic-highway-510207-a3.iam.gserviceaccount.com";
const DEFAULT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3sufqelEBKaOh\n8NYdTd2s7fT9YRI4ECj6RFuyAwy6aa+BWuYIUNot4u1Mig7ArrVuA3vyqlY46pLm\nPDuzrq5V/N+3f6NH2b4UnpSRWq3SOB230Trq0PjJJu30n4DGHDuCRpaoxrkgfxax\n9UXe5DV8VAz/zOJqDEcpsqbhKfmzWWPWugUqSJIjQWxftZi9N9HDiHtKoLCiT0VI\nF5K7dtA1Dco7WMfsZElVvj4vqmKzEGQLF2KdB/XhfVJaVlDXlmun2Gp/y7UDfqKP\ncFEkcV4rLNtTvUpGNt0cFqIl3ld4HS9Is9NhFd37bzbLwTOSoPCOgUbHFNe5uPHV\nAN8RI/CnAgMBAAECggEAI8TRRaXlif1qoEi92FzmEhsPfhrdqk7zO6/9zs6rNs0H\nYH+rlOjxYsfx/tpO/xPFvhMtmlWyjkiWrAAEe/tCdPnVMezHhWEPkwJB2X+3otxM\nZRN3jmt8VeafpOc98tVifP5zrY9sUriMWcBxh3IWPAw9r71cRNv5K1RfDC7ZMSOd\nSk7ZqPC2icqG5XcVfwQ+AOISli/CTY88IWzgMXoxCw9JvYKslgiCiHAl9AfAGBkq\nAWO44tav2B8Kt5+tM6yfuH7aIk/pOqdGCWWHUXwac1NuC4MNsJpDdWlDe2x1enB6\n2lsxL23atKHhlwExGywAuXp8SU8M1ECQibuLYtIgIQKBgQDZxfmqp9WEqqwo3RvQ\n7yGDaSRJQPJq5rGryKTE5CKURGQK/BBz4HiW200XPJnOxRZQ0u0j0U6UHOM39hiB\n1sUkIFybFclHot+hrGlJWOK7ZbXIgCqBEBoxk4TaBrKzICwPovksc1v1mluKH4mU\nf24Muy/uxgQrP/bb3yZXqt8vsQKBgQDX8bvrsjUdROJdaMMq2ENsUmfRLXFbZHq4\nMrwODLlaER2GGNtvQVyR3CVku/FXFlWsDdJKs2srgakIJIT4Coz2ns2gfOLXFpXh\nwjI1LFLVvPEJqOGfRT0wGpmWb8b6KsPcH/sOtmBz1ZmjYv+g6c99OSTQEvkUPuk1\njPjwbqTT1wKBgDknbE8NnUwkPuq6nQJIwFLs1Ukkcnr78MVU82l5NloTWO5JGUhQ\nMVXmWGUw0m0h7KlpsjMkS6szqa6WN/hblYHVvHg3T4wtguO7jCZj3Z2xI/RrLryQ\nrU81mDhgaaX5W5b+/sZbwFbFHCE0Bbejeg59UicocQ+oyfEKr9VyUwEBAoGBAM/R\nnXecPo+Xfn5E1ybBkEmMGMtvf1tkHNJuSRsAVdT/CbnG7E9qyMq64eXLFd0o6nQ1\nrP8lImtxUho7AxivFrA1blEYPzqeSspEmQshR+rY9ePE+rXL7bIAt3TWx9h0FaAf\nyv6Ct9piY4ShPsA+o+eweeQhjkJUtR1LOTwyT0BrAoGBAIuM1VHFURAxD0GkUuUk\npdqK3cwSoHGNBLFGLmLORYLOddAqs3ToPjqe7IpetIxMAECwNDk/649Hnf9eUfd0\niMLmjeePCyasoaw1cAjvJFtUKNrIGKINRnwfRD+gZWDNIxXJgU8CaymWhyJXd5UW\nc/faQvZuU6YKtKXB3SI/sRkf\n-----END PRIVATE KEY-----\n`;

function getSheetsClient() {
  try {
    const credPath = path.join(process.cwd(), "credentials.json");
    if (fs.existsSync(credPath)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
      });
      return google.sheets({ version: "v4", auth });
    }

    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || DEFAULT_CLIENT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || DEFAULT_PRIVATE_KEY;
    const privateKey = rawKey.replace(/\\n/g, "\n");

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    return google.sheets({ version: "v4", auth });
  } catch (e) {
    console.warn("Auth client creation warning:", e);
  }
  return null;
}

export async function fetchProducts(): Promise<Product[]> {
  const sheets = getSheetsClient();
  if (!sheets) return memoryProducts;

  const activeSheetId = SHEET_ID;

  try {
    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: activeSheetId,
        range: "products!A2:Z100"
      });
    } catch {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: activeSheetId,
        range: "Products!A2:Z100"
      });
    }

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryProducts;

    const fetchedProducts = rows
      .filter((row) => row && row.length > 0 && row[0])
      .map((row, index) => {
        if (row.length <= 7 || isNaN(parseFloat(row[0]))) {
          const category = row[0] || "General";
          const brand = row[1] || "";
          const modelName = row[2] || "";
          const fullName = brand && !modelName.toLowerCase().includes(brand.toLowerCase())
            ? `${brand} ${modelName}`
            : modelName || `${category} #${index + 1}`;
          const specs = row[3] || "";
          const bestFor = row[4] || "";
          const price = parseFloat(row[5]) || 0;
          const stock = parseInt(row[6], 10) || 0;

          return {
            id: `PROD-${101 + index}`,
            name: fullName,
            category: category,
            price: price,
            stock: stock,
            rating: 4.8,
            discount: "0%",
            description: `${specs}${bestFor ? ` (Best for: ${bestFor})` : ""}`
          };
        }

        return {
          id: row[0] || `PROD-${101 + index}`,
          name: row[1] || "",
          category: row[2] || "",
          price: parseFloat(row[3]) || 0,
          stock: parseInt(row[4], 10) || 0,
          rating: parseFloat(row[5]) || 4.8,
          discount: row[6] || "0%",
          description: row[7] || ""
        };
      });

    memoryProducts = fetchedProducts;
    return fetchedProducts;
  } catch (error: any) {
    console.error("Google Sheets API error in fetchProducts:", error?.message || error);
    return memoryProducts;
  }
}

export async function fetchOrders(): Promise<Order[]> {
  const sheets = getSheetsClient();
  if (!sheets) return memoryOrders;

  const activeSheetId = process.env.GOOGLE_SHEETS_ID || SHEET_ID;

  try {
    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: activeSheetId,
        range: "Orders!A2:Z100"
      });
    } catch {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: activeSheetId,
        range: "orders!A2:Z100"
      });
    }

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryOrders;

    const fetchedOrders = rows
      .filter((row) => row && row.length > 0 && row[0])
      .map((row) => {
        if (row.length <= 6 || (row[4] && !isNaN(parseInt(row[4], 10)) && row[4].length <= 3)) {
          const daysAgo = parseInt(row[4], 10) || 0;
          const d = new Date();
          d.setDate(d.getDate() - daysAgo);
          const orderDateStr = d.toISOString().split("T")[0];

          return {
            order_id: row[0] || "",
            customer_name: row[1] || "Customer",
            customer_email: `${(row[1] || "customer").toLowerCase().replace(/\s+/g, ".")}@example.com`,
            product_id: `PROD-${row[0]}`,
            product_name: row[2] || "Product",
            quantity: 1,
            total_price: row[3]?.toLowerCase().includes("electr") ? 499.99 : 99.99,
            order_date: orderDateStr,
            status: (row[5] as Order["status"]) || "Delivered",
            is_electronics: row[3]?.toLowerCase().includes("electr") || false
          };
        }

        return {
          order_id: row[0] || "",
          customer_name: row[1] || "",
          customer_email: row[2] || "",
          product_id: row[3] || "",
          product_name: row[4] || "",
          quantity: parseInt(row[5], 10) || 1,
          total_price: parseFloat(row[6]) || 0,
          order_date: row[7] || "",
          status: (row[8] as Order["status"]) || "Delivered",
          is_electronics: row[9]?.toLowerCase() === "true"
        };
      });

    memoryOrders = fetchedOrders;
    return fetchedOrders;
  } catch (error: any) {
    console.error("Google Sheets API error in fetchOrders:", error?.message || error);
    return memoryOrders;
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const orders = await fetchOrders();
  const cleanInput = orderId.trim().toLowerCase();

  const numMatch = cleanInput.match(/\d+/);
  const numStr = numMatch ? numMatch[0] : "";

  const found = orders.find((o) => {
    const oId = o.order_id.toLowerCase();
    const oIdNum = oId.replace(/\D/g, "");

    return (
      oId === cleanInput ||
      oId === `ord-${cleanInput}` ||
      (numStr && oIdNum === numStr) ||
      (numStr && oId.endsWith(numStr)) ||
      o.customer_name.toLowerCase().includes(cleanInput)
    );
  });

  return found || orders[0] || null;
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: Order["status"]
): Promise<boolean> {
  const order = memoryOrders.find((o) => o.order_id.toLowerCase() === orderId.toLowerCase());
  if (order) {
    order.status = newStatus;
  }

  const sheets = getSheetsClient();
  if (!sheets) return true;

  try {
    const orders = await fetchOrders();
    const index = orders.findIndex((o) => o.order_id.toLowerCase() === orderId.toLowerCase());
    if (index !== -1) {
      const rowIndex = index + 2;
      const activeSheetId = process.env.GOOGLE_SHEETS_ID || SHEET_ID;
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: activeSheetId,
          range: `Orders!F${rowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newStatus]]
          }
        });
      } catch {
        await sheets.spreadsheets.values.update({
          spreadsheetId: activeSheetId,
          range: `orders!F${rowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newStatus]]
          }
        });
      }
    }
    return true;
  } catch (err) {
    console.warn("Failed to update order status in Google Sheets:", err);
    return true;
  }
}

export async function saveBankDetails(data: BankDetails): Promise<boolean> {
  memoryBankDetails.push(data);

  const sheets = getSheetsClient();
  if (sheets) {
    const activeSheetId = process.env.GOOGLE_SHEETS_ID || SHEET_ID;
    const rowValues = [
      data.order_id || "",
      data.customer_name || "",
      data.product || "",
      data.bank_name || "",
      data.account_number || "",
      data.mobile_number || ""
    ];

    try {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "Bank_Details!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowValues] }
        });
      } catch {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "Bank_details!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowValues] }
        });
      }
      return true;
    } catch (err) {
      console.warn("Failed to save bank details to Google Sheets:", err);
    }
  }
  return true;
}

export async function logInteraction(log: Omit<InteractionLog, "log_id" | "timestamp">): Promise<InteractionLog> {
  const newLog: InteractionLog = {
    ...log,
    log_id: `LOG-${1000 + memoryLogs.length + 1}`,
    timestamp: new Date().toISOString()
  };

  memoryLogs.unshift(newLog);
  // Do NOT pollute Tab 3 (Bank_details) with interaction logs!
  return newLog;
}

export async function fetchLogs(): Promise<InteractionLog[]> {
  return memoryLogs;
}

export async function createNewOrder(
  customerName: string,
  productName: string,
  category: string = "electronics"
): Promise<Order> {
  const existingOrders = await fetchOrders();
  let maxNum = 106;
  existingOrders.forEach((o) => {
    const num = parseInt(o.order_id.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  });

  const newOrderId = `ORD-${maxNum + 1}`;
  const todayStr = new Date().toISOString().split("T")[0];

  const newOrder: Order = {
    order_id: newOrderId,
    customer_name: customerName || "Customer",
    customer_email: `${(customerName || "customer").toLowerCase().replace(/\s+/g, ".")}@example.com`,
    product_id: `PROD-${newOrderId}`,
    product_name: productName,
    quantity: 1,
    total_price: category.toLowerCase().includes("electr") ? 499.99 : 99.99,
    order_date: todayStr,
    status: "Delivered",
    is_electronics: true
  };

  memoryOrders.push(newOrder);

  const sheets = getSheetsClient();
  if (sheets) {
    const activeSheetId = process.env.GOOGLE_SHEETS_ID || SHEET_ID;
    try {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "Orders!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newOrderId, customerName || "Customer", productName, category, "0", "Delivered"]]
          }
        });
      } catch {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "orders!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newOrderId, customerName || "Customer", productName, category, "0", "Delivered"]]
          }
        });
      }
    } catch (err) {
      console.warn("Failed to append order to Google Sheets:", err);
    }
  }

  return newOrder;
}
