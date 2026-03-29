"use client";

import { useMutation } from "@tanstack/react-query";

import { createPayment } from "../lib/api";

export function useCreatePayment() {
  return useMutation({
    mutationFn: createPayment,
  });
}
