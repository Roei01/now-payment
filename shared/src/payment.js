import { z } from "zod";
export const cryptoCurrencySchema = z.enum(["BTC", "ETH", "USDT"]);
export const networkSchema = z.enum(["BTC", "ETH", "ERC20", "TRC20"]);
export const customerSchema = z.object({
    fullName: z.string().trim().min(2).max(80),
    email: z.email(),
    phone: z.string().trim().min(7).max(20),
});
export const createPaymentInputSchema = z
    .object({
    businessId: z.string().trim().min(2).max(50).default("default"),
    amountILS: z.coerce.number().positive().max(100000),
    cryptoCurrency: cryptoCurrencySchema,
    network: networkSchema,
    description: z.string().trim().min(2).max(120),
    customer: customerSchema,
})
    .superRefine((value, ctx) => {
    const validPairs = {
        BTC: ["BTC"],
        ETH: ["ETH", "ERC20"],
        USDT: ["ERC20", "TRC20"],
    };
    if (!validPairs[value.cryptoCurrency].includes(value.network)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["network"],
            message: "Selected network is not available for this currency.",
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
export const networkOptionsByCurrency = {
    BTC: ["BTC"],
    ETH: ["ETH", "ERC20"],
    USDT: ["ERC20", "TRC20"],
};
