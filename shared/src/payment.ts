import { z } from "zod";

export const cryptoCurrencySchema = z.enum(["BTC", "ETH", "USDT", "USDC"]);
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
      USDC: ["ERC20"],
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
  amountUSD: z.number().optional(),
  usdExchangeRate: z.number().optional(),
  usdExchangeRateFetchedAt: z.string().optional(),
  cryptoCurrency: cryptoCurrencySchema,
  network: networkSchema,
  description: z.string(),
  customer: customerSchema,
  nowPaymentId: z.string().optional(),
  nowInvoiceId: z.string().optional(),
  nowPurchaseId: z.string().optional(),
  nowPaymentStatus: paymentStatusSchema,
  nowPayCurrency: z.string().optional(),
  payAmount: z.number().optional(),
  payAddress: z.string().optional(),
  // Financial / settlement details captured from NOWPayments (used for the sheet).
  priceAmount: z.number().optional(),
  actuallyPaid: z.number().optional(),
  outcomeAmount: z.number().optional(),
  outcomeCurrency: z.string().optional(),
  paymentExtraIds: z.string().optional(),
  payinHash: z.string().optional(),
  payoutHash: z.string().optional(),
  networkFee: z.number().optional(),
  serviceFee: z.number().optional(),
  payoutAddress: z.string().optional(),
  nowCreatedAt: z.string().optional(),
  nowUpdatedAt: z.string().optional(),
  paymentUrl: z.string().url(),
  qrCodeUrl: z.string().url(),
  invoiceId: z.string().optional(),
  invoiceError: z.string().optional(),
  sheetsSyncedAt: z.string().optional(),
  completionState: paymentCompletionStateSchema,
  completionError: z.string().optional(),
  completionProcessedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createPaymentResponseSchema = z.object({
  payment_id: z.string(),
  pay_address: z.string().optional(),
  pay_amount: z.number().optional(),
  pay_currency: z.string().optional(),
  payment_url: z.string().url(),
  qr_code_url: z.string().url(),
  status: paymentStatusSchema,
});

export const paymentStatusResponseSchema = paymentRecordSchema.pick({
  id: true,
  amountILS: true,
  amountUSD: true,
  usdExchangeRate: true,
  usdExchangeRateFetchedAt: true,
  cryptoCurrency: true,
  network: true,
  description: true,
  customer: true,
  payAmount: true,
  payAddress: true,
  nowPayCurrency: true,
  paymentUrl: true,
  qrCodeUrl: true,
  nowPaymentStatus: true,
  completionState: true,
  invoiceId: true,
  invoiceError: true,
  createdAt: true,
  updatedAt: true,
});

// Lenient coercion helpers: NOWPayments sends numbers as strings/null and
// extra fields we don't model. We keep parsing tolerant so a real-world IPN
// payload (or GET /payment/{id} response) never breaks the pipeline.
const lenientString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) =>
    value === null || value === undefined ? undefined : String(value),
  );

const lenientNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const nowFeeSchema = z
  .object({
    currency: lenientString,
    depositFee: lenientNumber,
    withdrawalFee: lenientNumber,
    serviceFee: lenientNumber,
  })
  .nullish();

// Shape of both the NOWPayments IPN (webhook) payload and the
// GET /v1/payment/{id} response. Every field is optional so partial payloads
// (e.g. early "waiting" notifications) parse cleanly.
export const nowPaymentDetailsSchema = z
  .object({
    payment_id: lenientString,
    parent_payment_id: lenientString,
    invoice_id: lenientString,
    purchase_id: lenientString,
    payment_status: lenientString,
    order_id: lenientString,
    order_description: lenientString,
    price_amount: lenientNumber,
    price_currency: lenientString,
    pay_amount: lenientNumber,
    pay_currency: lenientString,
    pay_address: lenientString,
    payin_extra_id: lenientString,
    actually_paid: lenientNumber,
    outcome_amount: lenientNumber,
    outcome_currency: lenientString,
    payment_extra_ids: z.unknown().optional(),
    payin_hash: lenientString,
    payout_hash: lenientString,
    payout_address: lenientString,
    network: lenientString,
    network_fee: lenientNumber,
    service_fee: lenientNumber,
    fee: nowFeeSchema,
    created_at: lenientString,
    updated_at: lenientString,
  })
  .loose();

export const paymentWebhookSchema = nowPaymentDetailsSchema;

export const networkOptionsByCurrency: Record<CryptoCurrency, PaymentNetwork[]> = {
  BTC: ["BTC"],
  ETH: ["ETH", "ERC20"],
  USDT: ["ERC20", "TRC20"],
  USDC: ["ERC20"],
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
export type NowPaymentDetails = z.infer<typeof nowPaymentDetailsSchema>;
export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;
