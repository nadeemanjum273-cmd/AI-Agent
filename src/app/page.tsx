"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  User,
  Send,
  Sparkles,
  ShoppingBag,
  Receipt,
  BookOpen,
  FileSpreadsheet,
  RefreshCw,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Search,
  ExternalLink,
  Key,
  Info,
  ChevronRight
} from "lucide-react";
import { Product, Order, InteractionLog, GOOGLE_SHEET_URL } from "@/lib/types";

interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: string;
}

export default function EcommerceAgentApp() {
  const [activeTab, setActiveTab] = useState<"chat" | "products" | "orders" | "policy" | "logs">("chat");

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setMessages([
      {
        id: "welcome-1",
        role: "model",
        content: "Hello! I am Mind_Dream AI. How can I help you today?",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      }
    ]);
  }, []);
  const [inputQuery, setInputQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Data States
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [logs, setLogs] = useState<InteractionLog[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [searchProduct, setSearchProduct] = useState("");
  const [selectedOrderRefund, setSelectedOrderRefund] = useState<Order | null>(null);
  const [refundProcessing, setRefundProcessing] = useState(false);
  const [refundAlert, setRefundAlert] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Load initial data
  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    setLoadingData(true);
    try {
      const [prodRes, ordRes, logRes] = await Promise.all([
        fetch("/api/products").then((r) => r.json()),
        fetch("/api/orders").then((r) => r.json()),
        fetch("/api/logs").then((r) => r.json())
      ]);

      if (prodRes.products) setProducts(prodRes.products);
      if (ordRes.orders) setOrders(ordRes.orders);
      if (logRes.logs) setLogs(logRes.logs);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setLoadingData(false);
    }
  }

  // Handle Chat Submit
  async function handleSendMessage(textToSend?: string) {
    const query = textToSend || inputQuery;
    if (!query.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setIsTyping(true);

    try {
      const chatHistory = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory })
      });

      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "model",
        content: data.text || "I apologize, I couldn't complete that request.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };

      setMessages((prev) => [...prev, aiMsg]);
      // Refresh backend logs and orders state after AI action
      loadAllData();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "model",
          content: "⚠️ Network connection error. Please try again.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  // Direct Refund Evaluation Trigger
  async function handleProcessRefund(orderId: string) {
    setRefundProcessing(true);
    setRefundAlert(null);

    try {
      const res = await fetch("/api/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId })
      });

      const data = await res.json();

      if (data.eligible) {
        setRefundAlert({
          type: "success",
          message: `✅ Refund Approved for ${orderId}! Amount: $${data.order.total_price}. Confirmation email sent to ${data.order.customer_email}.`
        });
      } else {
        setRefundAlert({
          type: "error",
          message: `❌ Refund Ineligible for ${orderId}: ${data.evaluation.reason}`
        });
      }

      loadAllData();
    } catch (err) {
      setRefundAlert({ type: "error", message: "Failed to process refund." });
    } finally {
      setRefundProcessing(false);
    }
  }

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchProduct.toLowerCase()) ||
      p.category.toLowerCase().includes(searchProduct.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans">
      {/* Sleek Light Header */}
      <header className="sticky top-0 z-30 glass-nav px-4 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img src="/logo.png" alt="Mind_Dream AI Logo" className="w-10 h-10 rounded-xl object-cover border border-slate-300 shadow-md" />
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-slate-900 text-lg tracking-tight">Mind_Dream AI</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-soft-pulse"></span>
                Next.js + Google Sheets Live
              </span>
            </div>
            <p className="text-xs text-slate-500">Autonomous E-Commerce Support, Order Sync & Policy Agent</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => loadAllData()}
            title="Refresh Google Sheets & Logs"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          >
            <RefreshCw className={`w-4 h-4 ${loadingData ? "animate-spin text-indigo-600" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 max-w-[1600px] w-full mx-auto p-4 lg:p-6 flex flex-col gap-6">
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-2 p-1.5 bg-slate-200/60 rounded-xl max-w-fit border border-slate-300/40">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "chat"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
            }`}
          >
            <img src="/logo.png" alt="" className="w-4 h-4 rounded-full object-cover" />
            AI Chatbot (Mind_Dream AI)
          </button>

          <button
            onClick={() => setActiveTab("products")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "products"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            Products ({products.length})
          </button>

          <button
            onClick={() => setActiveTab("policy")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "policy"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Company Policy (.docx)
          </button>

          <button
            onClick={() => setActiveTab("logs")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "logs"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Sheets Interaction Logs ({logs.length})
          </button>
        </nav>

        {/* TAB 1: AI CHATBOT INTERFACE */}
        {activeTab === "chat" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
            {/* Main Chat Box */}
            <div className="lg:col-span-3 glass-panel rounded-2xl flex flex-col h-[650px] overflow-hidden">
              {/* Chat Header */}
              <div className="px-6 py-4 border-b border-slate-200/80 bg-white/60 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <img src="/logo.png" alt="Mind_Dream AI" className="w-9 h-9 rounded-full object-cover border border-slate-300 shadow-xs" />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Mind_Dream AI</h2>
                    <p className="text-[11px] text-slate-500">Grounded with Company Policy & Google Sheets Live Sync</p>
                  </div>
                </div>

                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Auto-evaluates & Syncs Orders
                </div>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {msg.role === "user" ? (
                      <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center shrink-0 text-xs font-bold">
                        <User className="w-4 h-4" />
                      </div>
                    ) : (
                      <img src="/logo.png" alt="Mind_Dream AI" className="w-8 h-8 rounded-full object-cover border border-slate-300 shrink-0 shadow-xs" />
                    )}

                    <div
                      className={`max-w-[92%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-indigo-600 text-white rounded-tr-none shadow-sm"
                          : "bg-white text-slate-800 border border-slate-200/90 rounded-tl-none shadow-xs"
                      }`}
                    >
                      <div className="whitespace-pre-line font-normal">{msg.content}</div>
                      <div
                        className={`text-[10px] mt-1.5 text-right ${
                          msg.role === "user" ? "text-indigo-200" : "text-slate-400"
                        }`}
                      >
                        {msg.timestamp}
                      </div>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex items-start gap-3">
                    <img src="/logo.png" alt="Mind_Dream AI" className="w-8 h-8 rounded-full object-cover border border-slate-300 shrink-0 animate-pulse" />
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 text-xs text-slate-500 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                      Mind_Dream AI is consulting policy & Google Sheets...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="p-4 bg-white border-t border-slate-200 flex items-center gap-3"
              >
                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder="Ask Mind_Dream AI about products, place an order, or submit an order ID for refund..."
                  className="flex-1 px-4 py-2.5 text-xs text-slate-900 bg-slate-100/80 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                />
                <button
                  type="submit"
                  disabled={!inputQuery.trim() || isTyping}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </form>
            </div>

            {/* Sidebar Overview Panel */}
            <div className="space-y-6">
              {/* Automated Actions Workflow Box */}
              <div className="glass-panel p-5 rounded-2xl space-y-3 bg-gradient-to-br from-indigo-50/50 to-white">
                <h3 className="text-xs font-bold text-indigo-950 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Agent Workflow Pipeline
                </h3>
                <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    <strong>Load Policies:</strong> Evaluates Word policy document rules.
                  </li>
                  <li>
                    <strong>Fetch Sheet Data:</strong> Live lookup of products & orders.
                  </li>
                  <li>
                    <strong>Evaluate Eligibility:</strong> Checks purchase date vs 15/30-day limits.
                  </li>
                  <li>
                    <strong>Execute Actions:</strong> Updates Google Sheet status + dispatches confirmation email to customer.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCTS CATALOG */}
        {activeTab === "products" && (
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-indigo-600" />
                  Products Catalog (Google Sheets Tab: Products)
                </h2>
                <p className="text-xs text-slate-500">Synchronized with live Google Sheet inventory & pricing data</p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search products or category..."
                  value={searchProduct}
                  onChange={(e) => setSearchProduct(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-100 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((p) => (
                <div key={p.id} className="p-4 bg-white border border-slate-200/90 rounded-xl hover:shadow-md transition space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                        {p.id}
                      </span>
                      <h3 className="font-bold text-slate-900 text-sm mt-1">{p.name}</h3>
                      <span className="text-[11px] text-indigo-600 font-medium">{p.category}</span>
                    </div>
                    {p.discount !== "0%" && (
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-bold rounded-md">
                        {p.discount}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2">{p.description}</p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-400 text-[11px]">Price:</span>{" "}
                      <strong className="text-slate-900 text-sm">${p.price}</strong>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-emerald-600 font-medium">Stock: {p.stock}</span>
                      <span className="text-amber-500 font-semibold">⭐ {p.rating}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: ORDERS & REFUNDS */}
        {activeTab === "orders" && (
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-indigo-600" />
                  Customer Orders & Refund Policy Evaluator
                </h2>
                <p className="text-xs text-slate-500">Test refund requests directly against company policy and sync status to Google Sheets</p>
              </div>
            </div>

            {refundAlert && (
              <div
                className={`p-4 rounded-xl text-xs flex items-center justify-between ${
                  refundAlert.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 border border-rose-200"
                }`}
              >
                <span>{refundAlert.message}</span>
                <button onClick={() => setRefundAlert(null)} className="text-slate-400 hover:text-slate-700">
                  &times;
                </button>
              </div>
            )}

            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Order ID</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Product Item</th>
                    <th className="p-3">Order Date</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {orders.map((ord) => (
                    <tr key={ord.order_id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3 font-mono font-bold text-indigo-600">{ord.order_id}</td>
                      <td className="p-3">
                        <div className="font-medium">{ord.customer_name}</div>
                        <div className="text-[10px] text-slate-400">{ord.customer_email}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{ord.product_name}</div>
                        <div className="text-[10px] text-slate-400">
                          {ord.is_electronics ? "⚡ Electronics" : "Standard"}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">{ord.order_date}</td>
                      <td className="p-3 font-bold">${ord.total_price}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            ord.status === "Refunded"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {ord.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {ord.status === "Refunded" ? (
                          <span className="text-[11px] text-slate-400 font-medium">Refund Completed</span>
                        ) : (
                          <button
                            onClick={() => handleProcessRefund(ord.order_id)}
                            disabled={refundProcessing}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold rounded-lg shadow-xs transition"
                          >
                            Evaluate & Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: POLICY KNOWLEDGE BASE (.DOCX) */}
        {activeTab === "policy" && (
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-indigo-600" />
                  TechMart Company Policy Document (`Word .txt`)
                </h2>
                <p className="text-xs text-slate-500">Authoritative policy rules used by AI Charlie for customer query answers & refund decisions</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Return Policy */}
              <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 text-indigo-600">
                  <RefreshCw className="w-4 h-4" />
                  RETURN POLICY
                </h3>
                <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
                  <li>Customers may return items within 30 days of purchase.</li>
                  <li>Must be unused and in original packaging with all accessories.</li>
                  <li className="font-semibold text-slate-900 bg-amber-50 p-1 rounded">
                    ⚡ Electronics (laptops, phones, tablets, watches) must be returned within 15 days.
                  </li>
                  <li>Items marked "Final Sale" cannot be returned or exchanged.</li>
                  <li>Initiate returns via support@techmart.com.</li>
                </ul>
              </div>

              {/* Refund Policy */}
              <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 text-emerald-600">
                  <Receipt className="w-4 h-4" />
                  REFUND POLICY
                </h3>
                <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
                  <li>Refunds processed within 5 business days after receiving item.</li>
                  <li>Issued to original payment method only.</li>
                  <li>Shipping costs non-refundable unless item is defective or wrong.</li>
                  <li>Credit card refunds take an additional 3–5 business days to appear.</li>
                </ul>
              </div>

              {/* Shipping Policy */}
              <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 text-indigo-600">
                  <Mail className="w-4 h-4" />
                  SHIPPING POLICY
                </h3>
                <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
                  <li>Standard shipping: 3–5 business days ($4.99).</li>
                  <li>Express shipping: 1–2 business days ($12.99).</li>
                  <li><strong>Free standard shipping on orders above $50.</strong></li>
                  <li>Ships to all 50 US states. No international shipping.</li>
                  <li>Orders placed before 2:00 PM EST dispatch same day.</li>
                </ul>
              </div>

              {/* Warranty & Exchange */}
              <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 text-indigo-600">
                  <ShieldCheck className="w-4 h-4" />
                  WARRANTY & EXCHANGES
                </h3>
                <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
                  <li>All electronics include a 1-year manufacturer hardware warranty.</li>
                  <li>Excludes physical damage, water damage, or unauthorized modifications.</li>
                  <li>Optional 2-year extended warranty available for laptops/desktops.</li>
                  <li>Exchanges allowed within 30 days (15 days for electronics).</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: GOOGLE SHEETS INTERACTION LOGS */}
        {activeTab === "logs" && (
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  Google Sheets Interaction Logs (`Bank_Details` Tab)
                </h2>
                <p className="text-xs text-slate-500">Automated interaction ledger updated whenever Mind_Dream AI handles an inquiry</p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Log ID</th>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Customer Email</th>
                    <th className="p-3">Order ID</th>
                    <th className="p-3">Action Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {logs.map((lg) => (
                    <tr key={lg.log_id} className="hover:bg-slate-50 transition">
                      <td className="p-3 font-mono font-bold text-slate-900">{lg.log_id}</td>
                      <td className="p-3 text-[11px] text-slate-500">{new Date(lg.timestamp).toLocaleString()}</td>
                      <td className="p-3 font-medium">{lg.customer_email}</td>
                      <td className="p-3 font-mono font-bold text-indigo-600">{lg.order_id || "N/A"}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            lg.action_type.includes("Approved")
                              ? "bg-emerald-100 text-emerald-700"
                              : lg.action_type.includes("Rejected")
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {lg.action_type}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-emerald-600 font-semibold">✓ {lg.status}</span>
                      </td>
                      <td className="p-3 text-slate-600 max-w-xs truncate">{lg.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* API Credentials Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-600" />
                API Credentials & Deployment Settings
              </h3>
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-slate-700 text-lg">
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-600">
              The application is configured with built-in default keys and Google Sheet synchronization. When deploying to Vercel, set these in your Vercel Environment Variables:
            </p>

            <div className="space-y-3 font-mono text-[11px] bg-slate-50 p-4 rounded-xl border border-slate-200 text-slate-800">
              <div>
                <span className="text-slate-500">GEMINI_API_KEY=</span>
                <span className="text-indigo-600">AIzaSyBJGN9Olyey...</span>
              </div>
              <div>
                <span className="text-slate-500">GOOGLE_SHEETS_ID=</span>
                <span className="text-emerald-600">1zTUpdY8ufxg6aPTV-5WLDrkyxughn7NP</span>
              </div>
              <div>
                <span className="text-slate-500">GOOGLE_CLIENT_EMAIL=</span>
                <span className="text-slate-700">your-service-account@gcp.iam.gserviceaccount.com</span>
              </div>
              <div>
                <span className="text-slate-500">SMTP_USER=</span>
                <span className="text-slate-700">support@techmart.com</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700"
              >
                Close & Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sleek Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        Mind_Dream AI Support Agent &copy; 2026 | Next.js Capstone Project | Vercel & GitHub Ready
      </footer>
    </div>
  );
}
