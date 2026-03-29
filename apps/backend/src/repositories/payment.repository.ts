import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { paymentRecordSchema, type PaymentRecord } from "@now-payment/shared";

import { env } from "../config/env.js";

export class PaymentRepository {
  private readonly records = new Map<string, PaymentRecord>();
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly filePath: string) {}

  async init() {
    if (this.initialized) {
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as unknown[];

      for (const item of parsed) {
        const normalizedItem = this.normalizeLegacyRecord(item);
        const record = paymentRecordSchema.parse(normalizedItem);
        this.records.set(record.id, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    this.initialized = true;
  }

  async save(record: PaymentRecord) {
    this.records.set(record.id, record);
    await this.persist();
    return record;
  }

  async getById(id: string) {
    return this.records.get(id) ?? null;
  }

  async getByNowPaymentId(nowPaymentId: string) {
    return (
      [...this.records.values()].find((record) => record.nowPaymentId === nowPaymentId) ?? null
    );
  }

  async update(id: string, updater: (existing: PaymentRecord) => PaymentRecord) {
    const existing = this.records.get(id);

    if (!existing) {
      return null;
    }

    const updated = updater(existing);
    this.records.set(id, updated);
    await this.persist();
    return updated;
  }

  private async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const payload = JSON.stringify([...this.records.values()], null, 2);
      await writeFile(this.filePath, payload, "utf8");
    });

    return this.writeQueue;
  }

  private normalizeLegacyRecord(item: unknown) {
    if (!item || typeof item !== "object") {
      return item;
    }

    const draft = { ...(item as Record<string, unknown>) };
    const recordId = typeof draft.id === "string" ? draft.id : null;

    if (recordId && typeof draft.paymentUrl !== "string") {
      draft.paymentUrl = `${env.BASE_URL}/payment/${recordId}`;
    }

    if (recordId && typeof draft.qrCodeUrl !== "string") {
      draft.qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(
        `${env.BASE_URL}/payment/${recordId}`,
      )}`;
    }

    return draft;
  }
}
