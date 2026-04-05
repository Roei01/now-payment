"use client";

import type {
  CreatePaymentInput,
  CreatePaymentResponse,
  PaymentStatusResponse,
} from "@now-payment/shared";
import axios from "axios";

const client = axios.create({
  baseURL: "/api/payment",
  timeout: 45000,
});

export async function createPayment(payload: CreatePaymentInput) {
  const response = await client.post<CreatePaymentResponse>("/create", payload);
  return response.data;
}

export async function getPaymentStatus(paymentId: string) {
  const response = await client.get<PaymentStatusResponse>(`/${paymentId}`);
  return response.data;
}
