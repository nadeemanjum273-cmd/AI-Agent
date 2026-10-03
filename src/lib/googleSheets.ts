import { google } from "googleapis";
import { Product, Order, InteractionLog, GOOGLE_SHEET_URL } from "./types";

export type { Product, Order, InteractionLog };
export { GOOGLE_SHEET_URL };

// Initial Mock / Fallback Sync Data matching Google Sheet GIDs
const INITIAL_PRODUCTS: Product[] = [
  {
    id: "PROD-101",
    name: "Wireless Noise-Canceling Headphones",
    category: "Audio",
    price: 199.99,
    stock: 45,
    rating: 4.8,
    discount: "15% OFF",
    description: "Premium over-ear noise-canceling headphones with 30h battery life and HD audio clarity."
  },
  {
    id: "PROD-102",
    name: "UltraBook Pro 15 Laptop",
    category: "Laptops",
    price: 1299.00,
    stock: 12,
    rating: 4.7,
    discount: "10% OFF",
    description: "Sleek 15-inch aluminum laptop with M3 chipset, 16GB RAM, 512GB SSD."
  },
  {
    id: "PROD-103",
    name: "Smart Fitness Watch",
    category: "Wearables",
    price: 149.50,
    stock: 30,
    rating: 4.5,
    discount: "5% OFF",
    description: "AMOLED fitness tracker with heart-rate monitoring, GPS, and 7-day battery."
  },
  {
    id: "PROD-104",
    name: "Mechanical RGB Gaming Keyboard",
    category: "Accessories",
    price: 89.99,
    stock: 85,
    rating: 4.9,
    discount: "0%",
    description: "Tactile mechanical keyboard with customizable RGB backlighting and hot-swappable switches."
  },
  {
    id: "PROD-105",
    name: "Ergonomic Wireless Mouse",
    category: "Accessories",
    price: 49.99,
    stock: 120,
    rating: 4.6,
    discount: "10% OFF",
    description: "Precision optical wireless mouse designed for comfort and extended productivity."
  },
  {
    id: "PROD-106",
    name: "4K Ultra HD 27-inch Monitor",
    category: "Displays",
    price: 349.00,
    stock: 18,
    rating: 4.7,
    discount: "20% OFF",
    description: "IPS panel 4K UHD monitor with HDR400, USB-C 65W charging, and ultra-thin bezels."
  }
];

const INITIAL_ORDERS: Order[] = [
  {
    order_id: "ORD-9021",
    customer_name: "Sarah Jenkins",
    customer_email: "sarah.j@example.com",
    product_id: "PROD-101",
    product_name: "Wireless Noise-Canceling Headphones",
    quantity: 1,
    total_price: 169.99,
    order_date: "2026-09-28", // Purchased 5 days ago (Within 15-day electronics window)
    status: "Delivered",
    is_electronics: true
  },
  {
    order_id: "ORD-9022",
    customer_name: "Michael Chen",
    customer_email: "m.chen@example.com",
    product_id: "PROD-102",
    product_name: "UltraBook Pro 15 Laptop",
    quantity: 1,
    total_price: 1169.10,
    order_date: "2026-09-01", // Purchased >30 days ago (Expired)
    status: "Delivered",
    is_electronics: true
  },
  {
    order_id: "ORD-9023",
    customer_name: "Emily Rodriguez",
    customer_email: "emily.r@example.com",
    product_id: "PROD-105",
    product_name: "Ergonomic Wireless Mouse",
    quantity: 2,
    total_price: 89.98,
    order_date: "2026-09-20", // Purchased 13 days ago (Within 30-day non-electronics window)
    status: "Delivered",
    is_electronics: false
  },
  {
    order_id: "ORD-9024",
    customer_name: "David Miller",
    customer_email: "david.m@example.com",
    product_id: "PROD-103",
    product_name: "Smart Fitness Watch",
    quantity: 1,
    total_price: 142.02,
    order_date: "2026-08-15", // Purchased >45 days ago (Expired)
    status: "Delivered",
    is_electronics: true
  },
  {
    order_id: "ORD-9025",
    customer_name: "Alex Vance",
    customer_email: "alex.vance@example.com",
    product_id: "PROD-106",
    product_name: "4K Ultra HD 27-inch Monitor",
    quantity: 1,
    total_price: 279.20,
    order_date: "2026-10-01", // Purchased 2 days ago
    status: "Shipped",
    is_electronics: true
  }
];

const INITIAL_LOGS: InteractionLog[] = [
  {
    log_id: "LOG-1001",
    timestamp: new Date("2026-10-02T14:32:00Z").toISOString(),
    customer_email: "sarah.j@example.com",
    order_id: "ORD-9021",
    action_type: "Order Inquiry",
    status: "Completed",
    details: "Checked delivery tracking status for ORD-9021."
  }
];

// Global in-memory storage for active session fallback
let memoryProducts = [...INITIAL_PRODUCTS];
let memoryOrders = [...INITIAL_ORDERS];
let memoryLogs = [...INITIAL_LOGS];

export const SHEET_ID = process.env.GOOGLE_SHEETS_ID || "1zTUpdY8ufxg6aPTV-5WLDrkyxughn7NP";

/**
 * Get Google Sheets API instance if service account credentials are available
 */
function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

export async function fetchProducts(): Promise<Product[]> {
  const sheets = getSheetsClient();
  if (!sheets) return memoryProducts;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Products!A2:H50"
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryProducts;

    return rows.map((row) => ({
      id: row[0] || "",
      name: row[1] || "",
      category: row[2] || "",
      price: parseFloat(row[3]) || 0,
      stock: parseInt(row[4], 10) || 0,
      rating: parseFloat(row[5]) || 0,
      discount: row[6] || "0%",
      description: row[7] || ""
    }));
  } catch (error) {
    console.warn("Google Sheets API fetch failed, falling back to local dataset:", error);
    return memoryProducts;
  }
}

export async function fetchOrders(): Promise<Order[]> {
  const sheets = getSheetsClient();
  if (!sheets) return memoryOrders;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Orders!A2:K50"
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryOrders;

    return rows.map((row) => ({
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
    }));
  } catch (error) {
    console.warn("Google Sheets API fetch failed, using memory orders:", error);
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
  // Update memory state
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
        range: "Bank_Details!A:G",
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
      range: "Bank_Details!A2:G100"
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return memoryLogs;

    const sheetsLogs: InteractionLog[] = rows.map((row) => ({
      log_id: row[0] || "",
      timestamp: row[1] || new Date().toISOString(),
      customer_email: row[2] || "",
      order_id: row[3] || "",
      action_type: row[4] as InteractionLog["action_type"] || "Order Inquiry",
      status: row[5] as InteractionLog["status"] || "Completed",
      details: row[6] || ""
    }));

    return [...sheetsLogs, ...memoryLogs];
  } catch {
    return memoryLogs;
  }
}
