"use client";

import type { CreatePaymentInput } from "@now-payment/shared";
import { create } from "zustand";

type PaymentDraftState = {
  draft: CreatePaymentInput;
  setDraft: (nextDraft: Partial<CreatePaymentInput>) => void;
  resetDraft: () => void;
};

const initialDraft: CreatePaymentInput = {
  businessId: "default",
  amountILS: 180,
  cryptoCurrency: "USDT",
  network: "TRC20",
  description: "Table 12",
  customer: {
    fullName: "",
    email: "",
    phone: "",
  },
};

export const usePaymentDraftStore = create<PaymentDraftState>((set) => ({
  draft: initialDraft,
  setDraft: (nextDraft) =>
    set((state) => ({
      draft: {
        ...state.draft,
        ...nextDraft,
        customer: {
          ...state.draft.customer,
          ...nextDraft.customer,
        },
      },
    })),
  resetDraft: () => set({ draft: initialDraft }),
}));
