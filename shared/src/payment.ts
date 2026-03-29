import { z } from "zod";

export const cryptoCurrencySchema = z.enum(["BTC", "ETH", "USDT"]);
export const networkSchema = z.enum(["BTC", "ETH", "ERC20", "TRC20"]);

export const customerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "יש להזין שם מלא תקין.")
    .max(80, "השם המלא ארוך מדי."),
  email: z.string().trim().email("יש להזין כתובת אימייל תקינה."),
  phone: z
    .string()
    .trim()
    .min(7, "יש להזין מספר טלפון תקין.")
    .max(20, "מספר הטלפון ארוך מדי."),
});

export const createPaymentInputSchema = z
  .object({
    businessId: z
      .string()
      .trim()
      .min(2, "יש להזין מזהה עסק תקין.")
      .max(50, "מזהה העסק ארוך מדי.")
      .default("default"),
    amountILS: z.coerce
      .number()
      .positive("הסכום חייב להיות גדול מ-0.")
      .max(100000, "הסכום חורג מהמגבלה המותרת."),
    cryptoCurrency: cryptoCurrencySchema,
    network: networkSchema,
    description: z
      .string()
      .trim()
      .min(2, "יש להזין תיאור או מספר שולחן.")
      .max(120, "התיאור ארוך מדי."),
    customer: customerSchema,
  })
  .superRefine((value, ctx) => {
    const validPairs: Record<CryptoCurrency, PaymentNetwork[]> = {
      BTC: ["BTC"],
      ETH: ["ETH", "ERC20"],
      USDT: ["ERC20", "TRC20"],
    };

    if (!validPairs[value.cryptoCurrency].includes(value.network)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network"],
        message: "הרשת שנבחרה אינה תואמת למטבע שבחרת.",
      });
    }
  });

export const paymentStatusSchema = z.enum([
  "waiting",
  "confirming",
  "finished",
  "failed",
  "expired",
  "partially_paid",
  "refunded",
]);

export const paymentCompletionStateSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const paymentRecordSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  amountILS: z.number(),
  cryptoCurrency: cryptoCurrencySchema,
  network: networkSchema,
  description: z.string(),
  customer: customerSchema,
  nowPaymentId: z.string(),
  nowPaymentStatus: paymentStatusSchema,
  nowPayCurrency: z.string(),
  payAmount: z.number(),
  payAddress: z.string(),
  paymentUrl: z.string().url(),
  qrCodeUrl: z.string().url(),
  invoiceId: z.string().optional(),
  sheetsSyncedAt: z.string().optional(),
  completionState: paymentCompletionStateSchema,
  completionError: z.string().optional(),
  completionProcessedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createPaymentResponseSchema = z.object({
  payment_id: z.string(),
  pay_address: z.string(),
  pay_amount: z.number(),
  payment_url: z.string().url(),
  qr_code_url: z.string().url(),
  status: paymentStatusSchema,
});

export const paymentStatusResponseSchema = paymentRecordSchema.pick({
  id: true,
  amountILS: true,
  cryptoCurrency: true,
  network: true,
  description: true,
  customer: true,
  payAmount: true,
  payAddress: true,
  paymentUrl: true,
  qrCodeUrl: true,
  nowPaymentStatus: true,
  completionState: true,
  invoiceId: true,
  createdAt: true,
  updatedAt: true,
});

export const paymentWebhookSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform(String),
  payment_status: paymentStatusSchema,
  order_id: z.union([z.string(), z.number()]).transform(String).optional(),
  price_amount: z.coerce.number().optional(),
  pay_amount: z.coerce.number().optional(),
  pay_currency: z.string().optional(),
});

export const networkOptionsByCurrency: Record<CryptoCurrency, PaymentNetwork[]> = {
  BTC: ["BTC"],
  ETH: ["ETH", "ERC20"],
  USDT: ["ERC20", "TRC20"],
};

export type CryptoCurrency = z.infer<typeof cryptoCurrencySchema>;
export type PaymentNetwork = z.infer<typeof networkSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentCompletionState = z.infer<typeof paymentCompletionStateSchema>;
export type PaymentStatusResponse = z.infer<typeof paymentStatusResponseSchema>;
export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;
