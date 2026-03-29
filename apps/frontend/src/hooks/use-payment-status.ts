"use client";

import { useQuery } from "@tanstack/react-query";

import { getPaymentStatus } from "../lib/api";

export function usePaymentStatus(paymentId: string) {
  return useQuery({
    queryKey: ["payment-status", paymentId],
    queryFn: () => getPaymentStatus(paymentId),
    refetchInterval: (query) => {
      const payment = query.state.data;

      if (!payment) {
        return 3000;
      }

      return payment.nowPaymentStatus === "finished" && payment.completionState === "completed"
        ? false
        : 3000;
    },
  });
}
