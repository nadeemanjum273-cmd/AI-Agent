import { NextRequest, NextResponse } from "next/server";
import { getOrderById, updateOrderStatus, logInteraction } from "@/lib/googleSheets";
import { evaluateRefundEligibility } from "@/lib/policy";
import { sendRefundConfirmationEmail } from "@/lib/emailService";

export async function POST(req: NextRequest) {
  try {
    const { orderId, isDefective } = await req.json();

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required." },
        { status: 400 }
      );
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json(
        { error: `Order #${orderId} was not found in Google Sheets.` },
        { status: 404 }
      );
    }

    const evalResult = evaluateRefundEligibility(
      order.order_date,
      order.is_electronics,
      order.is_final_sale,
      isDefective
    );

    if (evalResult.eligible) {
      await updateOrderStatus(order.order_id, "Refunded");

      const emailResult = await sendRefundConfirmationEmail({
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
        details: `Refund of $${order.total_price} approved and processed. Email confirmation sent.`
      });

      return NextResponse.json({
        success: true,
        eligible: true,
        order,
        evaluation: evalResult,
        emailSent: emailResult.success,
        simulatedEmail: emailResult.simulated
      });
    } else {
      await logInteraction({
        customer_email: order.customer_email,
        order_id: order.order_id,
        action_type: "Refund Rejected",
        status: "Completed",
        details: evalResult.reason
      });

      return NextResponse.json({
        success: false,
        eligible: false,
        order,
        evaluation: evalResult
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to process refund request." },
      { status: 500 }
    );
  }
}
