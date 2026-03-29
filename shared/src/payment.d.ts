import { z } from "zod";
export declare const cryptoCurrencySchema: z.ZodEnum<{
    BTC: "BTC";
    ETH: "ETH";
    USDT: "USDT";
}>;
export declare const networkSchema: z.ZodEnum<{
    BTC: "BTC";
    ETH: "ETH";
    ERC20: "ERC20";
    TRC20: "TRC20";
}>;
export declare const customerSchema: z.ZodObject<{
    fullName: z.ZodString;
    email: z.ZodEmail;
    phone: z.ZodString;
}, z.core.$strip>;
export declare const createPaymentInputSchema: z.ZodObject<{
    businessId: z.ZodDefault<z.ZodString>;
    amountILS: z.ZodCoercedNumber<unknown>;
    cryptoCurrency: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        USDT: "USDT";
    }>;
    network: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        ERC20: "ERC20";
        TRC20: "TRC20";
    }>;
    description: z.ZodString;
    customer: z.ZodObject<{
        fullName: z.ZodString;
        email: z.ZodEmail;
        phone: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const paymentStatusSchema: z.ZodEnum<{
    waiting: "waiting";
    confirming: "confirming";
    finished: "finished";
    failed: "failed";
    expired: "expired";
    partially_paid: "partially_paid";
    refunded: "refunded";
}>;
export declare const paymentCompletionStateSchema: z.ZodEnum<{
    failed: "failed";
    pending: "pending";
    processing: "processing";
    completed: "completed";
}>;
export declare const paymentRecordSchema: z.ZodObject<{
    id: z.ZodString;
    businessId: z.ZodString;
    amountILS: z.ZodNumber;
    cryptoCurrency: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        USDT: "USDT";
    }>;
    network: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        ERC20: "ERC20";
        TRC20: "TRC20";
    }>;
    description: z.ZodString;
    customer: z.ZodObject<{
        fullName: z.ZodString;
        email: z.ZodEmail;
        phone: z.ZodString;
    }, z.core.$strip>;
    nowPaymentId: z.ZodString;
    nowPaymentStatus: z.ZodEnum<{
        waiting: "waiting";
        confirming: "confirming";
        finished: "finished";
        failed: "failed";
        expired: "expired";
        partially_paid: "partially_paid";
        refunded: "refunded";
    }>;
    nowPayCurrency: z.ZodString;
    payAmount: z.ZodNumber;
    payAddress: z.ZodString;
    qrCodeUrl: z.ZodString;
    invoiceId: z.ZodOptional<z.ZodString>;
    sheetsSyncedAt: z.ZodOptional<z.ZodString>;
    completionState: z.ZodEnum<{
        failed: "failed";
        pending: "pending";
        processing: "processing";
        completed: "completed";
    }>;
    completionError: z.ZodOptional<z.ZodString>;
    completionProcessedAt: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const createPaymentResponseSchema: z.ZodObject<{
    payment_id: z.ZodString;
    pay_address: z.ZodString;
    pay_amount: z.ZodNumber;
    qr_code_url: z.ZodString;
    status: z.ZodEnum<{
        waiting: "waiting";
        confirming: "confirming";
        finished: "finished";
        failed: "failed";
        expired: "expired";
        partially_paid: "partially_paid";
        refunded: "refunded";
    }>;
}, z.core.$strip>;
export declare const paymentStatusResponseSchema: z.ZodObject<{
    cryptoCurrency: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        USDT: "USDT";
    }>;
    network: z.ZodEnum<{
        BTC: "BTC";
        ETH: "ETH";
        ERC20: "ERC20";
        TRC20: "TRC20";
    }>;
    customer: z.ZodObject<{
        fullName: z.ZodString;
        email: z.ZodEmail;
        phone: z.ZodString;
    }, z.core.$strip>;
    amountILS: z.ZodNumber;
    description: z.ZodString;
    nowPaymentStatus: z.ZodEnum<{
        waiting: "waiting";
        confirming: "confirming";
        finished: "finished";
        failed: "failed";
        expired: "expired";
        partially_paid: "partially_paid";
        refunded: "refunded";
    }>;
    completionState: z.ZodEnum<{
        failed: "failed";
        pending: "pending";
        processing: "processing";
        completed: "completed";
    }>;
    id: z.ZodString;
    payAmount: z.ZodNumber;
    payAddress: z.ZodString;
    qrCodeUrl: z.ZodString;
    invoiceId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const paymentWebhookSchema: z.ZodObject<{
    payment_id: z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>;
    payment_status: z.ZodEnum<{
        waiting: "waiting";
        confirming: "confirming";
        finished: "finished";
        failed: "failed";
        expired: "expired";
        partially_paid: "partially_paid";
        refunded: "refunded";
    }>;
    order_id: z.ZodOptional<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>>;
    price_amount: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    pay_amount: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    pay_currency: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const networkOptionsByCurrency: Record<CryptoCurrency, PaymentNetwork[]>;
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
