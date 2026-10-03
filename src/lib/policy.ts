export interface PolicySection {
  title: string;
  rules: string[];
}

export const COMPANY_POLICY = {
  companyName: "TechMart Online Store",
  lastUpdated: "2026-10-01",
  sections: [
    {
      title: "RETURN POLICY",
      rules: [
        "Customers may return items within 30 days of the purchase date.",
        "All returned items must be unused and in their original packaging with all accessories included.",
        "Electronics such as laptops, phones, and tablets must be returned within 15 days.",
        "Items marked as 'Final Sale' cannot be returned or exchanged.",
        "To initiate a return, contact support@techmart.com with your order number."
      ]
    },
    {
      title: "REFUND POLICY",
      rules: [
        "Refunds are processed within 5 business days after the returned item is received.",
        "Refunds are issued to the original payment method only.",
        "Shipping costs are non-refundable unless the return is due to a defective or wrong item.",
        "If paid by credit card, it may take an additional 3–5 business days for the refund to appear."
      ]
    },
    {
      title: "SHIPPING POLICY",
      rules: [
        "Standard shipping takes 3–5 business days and costs $4.99.",
        "Express shipping takes 1–2 business days and costs $12.99.",
        "Free standard shipping is available on all orders above $50.",
        "We currently ship to all 50 US states. International shipping is not available.",
        "Orders placed before 2:00 PM EST are dispatched the same day."
      ]
    },
    {
      title: "WARRANTY POLICY",
      rules: [
        "All electronics come with a 1-year manufacturer warranty covering hardware defects.",
        "The warranty does not cover physical damage, water damage, or unauthorized modifications.",
        "To claim warranty service, contact support@techmart.com with proof of purchase.",
        "Laptops and desktops come with an optional 2-year extended warranty available for purchase."
      ]
    },
    {
      title: "EXCHANGE POLICY",
      rules: [
        "Exchanges are allowed within 30 days of purchase (15 days for electronics).",
        "The item being exchanged must be in original condition."
      ]
    }
  ]
};

export function evaluateRefundEligibility(
  orderDateStr: string,
  isElectronics: boolean,
  isFinalSale: boolean = false,
  isDefective: boolean = false
): { eligible: boolean; reason: string; daysElapsed: number } {
  const orderDate = new Date(orderDateStr);
  const currentDate = new Date(); // Current system date
  const diffTime = Math.abs(currentDate.getTime() - orderDate.getTime());
  const daysElapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (isFinalSale) {
    return {
      eligible: false,
      reason: "Item is marked as 'Final Sale' and cannot be returned or refunded.",
      daysElapsed
    };
  }

  const maxDays = isElectronics ? 15 : 30;

  if (daysElapsed > maxDays) {
    return {
      eligible: false,
      reason: `Return window expired. Item was purchased ${daysElapsed} days ago. Maximum return window for ${
        isElectronics ? "electronics is 15" : "standard items is 30"
      } days.`,
      daysElapsed
    };
  }

  return {
    eligible: true,
    reason: `Refund request is eligible! Purchased ${daysElapsed} days ago (Within the ${maxDays}-day policy limit). ${
      isDefective ? "Defective item verified: Shipping fee is also refundable." : ""
    }`,
    daysElapsed
  };
}
