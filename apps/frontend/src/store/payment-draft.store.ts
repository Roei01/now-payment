"use client";

import type { CreatePaymentInput } from "@now-payment/shared";
import { create } from "zustand";

type PaymentDraftState = {
  draft: CreatePaymentInput;
  setDraft: (nextDraft: PaymentDraftPatch) => void;
  resetDraft: () => void;
};

type PaymentDraftPatch = Partial<Omit<CreatePaymentInput, "customer">> & {
  customer?: Partial<CreatePaymentInput["customer"]>;
};

const initialDraft: CreatePaymentInput = {
  businessId: "default",
  amountILS: 180,
  cryptoCurrency: "USDT",
  network: "ERC20",
  description: "",
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
