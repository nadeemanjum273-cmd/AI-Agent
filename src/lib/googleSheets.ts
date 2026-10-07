import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { Product, Order, InteractionLog, GOOGLE_SHEET_URL } from "./types";

export type { Product, Order, InteractionLog };
export { GOOGLE_SHEET_URL };

export interface BankDetails {
  customer_email: string;
  order_id: string;
  bank_name: string;
  account_number: string;
  mobile_number: string;
}

// Memory cache initialized empty - all data is fetched in real-time from Google Sheets
let memoryProducts: Product[] = [];
let memoryOrders: Order[] = [];
let memoryLogs: InteractionLog[] = [];
let memoryBankDetails: BankDetails[] = [];

export const SHEET_ID = "1JeGY2xGqj-GQABEZlPrfvso8L9ukQLGgPgPqsFUfOuA";

function getSheetsClient() {
  try {
    const credPath = path.join(process.cwd(), "credentials.json");
    if (fs.existsSync(credPath)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
      });
      return google.sheets({ version: "v4", auth });
    } else {
      console.warn("credentials.json not found at:", credPath);
    }

    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (clientEmail && privateKey) {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
      });
      return google.sheets({ version: "v4", auth });
    }
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
        // Handle 7-column layout (Category, Brand, Model Name, Key Specifications, Best For, price, stock)
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

        // Standard 8-column layout (ID, Name, Category, Price, Stock, Rating, Discount, Description)
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
        // Check if user's 5-6 column format (order_id, customer, product, category, days_ago, Refund Status)
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

        // Standard 10-column format
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
  const found = orders.find(
    (o) => o.order_id.toLowerCase() === orderId.trim().toLowerCase()
  );
  return found || null;
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
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Orders!I${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[newStatus]]
        }
      });
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
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Bank_Details!A:E",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              data.customer_email,
              data.order_id,
              data.bank_name,
              data.account_number,
              data.mobile_number
            ]
          ]
        }
      });
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

  const sheets = getSheetsClient();
  if (sheets) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Bank_Details!F:L",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              newLog.log_id,
              newLog.timestamp,
              newLog.customer_email,
              newLog.order_id,
              newLog.action_type,
              newLog.status,
              newLog.details
            ]
          ]
        }
      });
    } catch (err) {
      console.warn("Failed to append interaction log to Google Sheets:", err);
    }
  }

  return newLog;
}

export async function fetchLogs(): Promise<InteractionLog[]> {
  const sheets = getSheetsClient();
  if (!sheets) return memoryLogs;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Bank_Details!F2:L100"
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryLogs;

    const sheetsLogs: InteractionLog[] = rows.map((row) => ({
      log_id: row[0] || "",
      timestamp: row[1] || new Date().toISOString(),
      customer_email: row[2] || "",
      order_id: row[3] || "",
      action_type: (row[4] as InteractionLog["action_type"]) || "Order Inquiry",
      status: (row[5] as InteractionLog["status"]) || "Completed",
      details: row[6] || ""
    }));

    return [...sheetsLogs, ...memoryLogs];
  } catch {
    return memoryLogs;
  }
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
    customer_name: customerName || "Nadeem",
    customer_email: `${(customerName || "nadeem").toLowerCase().replace(/\s+/g, ".")}@example.com`,
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
      let targetRange = "Orders!A:F";
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "Orders!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newOrderId, customerName || "Nadeem", productName, category, "0", "Delivered"]]
          }
        });
      } catch {
        await sheets.spreadsheets.values.append({
          spreadsheetId: activeSheetId,
          range: "orders!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[newOrderId, customerName || "Nadeem", productName, category, "0", "Delivered"]]
          }
        });
      }
    } catch (err) {
      console.warn("Failed to append order to Google Sheets:", err);
    }
  }

  return newOrder;
}
