export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  rating: number;
  discount: string;
  description: string;
}

export interface Order {
  order_id: string;
  customer_name: string;
  customer_email: string;
  product_id: string;
  product_name: string;
  quantity: number;
  total_price: number;
  order_date: string;
  status: "Delivered" | "Shipped" | "Processing" | "Refunded" | "Refund Pending";
  is_electronics: boolean;
  is_final_sale?: boolean;
}

export interface InteractionLog {
  log_id: string;
  timestamp: string;
  customer_email: string;
  order_id: string;
  action_type: "Policy Query" | "Refund Request" | "Order Inquiry" | "Refund Approved" | "Refund Rejected";
  status: "Completed" | "Pending" | "Failed";
  details: string;
}

export const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1zTUpdY8ufxg6aPTV-5WLDrkyxughn7NP/edit";
