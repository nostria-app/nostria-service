
import { Tier, BillingCycle } from "../config/types";
import BaseTableStorageService from "./BaseTableStorageService";

export const INVOICE_TTL = 15 * 60 * 1000; // 15 minutes

export interface PaymentInvoice {
  id: string;
  hash: string;
  invoice: string;
  amountSat: number;
  tier: Tier;
  billingCycle: BillingCycle;
  priceCents: number;
  pubkey: string;
  username?: string;
  isPaid: boolean;
  createdAt: Date;
  expiresAt: Date;
  paidAt?: Date;
}

type CreatePaymentInvoiceDto = {
  id: string;
  hash: string;
  invoice: string;
  amountSat: number;
  tier: Tier;
  billingCycle: BillingCycle;
  priceCents: number;
  pubkey: string;
  username?: string;
}

class PaymentService extends BaseTableStorageService<PaymentInvoice> {
  constructor() {
    super("payments");
  }

  async createInvoice(data: CreatePaymentInvoiceDto): Promise<PaymentInvoice> {
    const now = new Date();

    const paymentInvoice: PaymentInvoice = {
      ...data,
      isPaid: false,
      expiresAt: new Date(now.getTime() + INVOICE_TTL),
      createdAt: now,
    };

    await this.tableClient.upsertEntity({
      partitionKey: 'payment',
      rowKey: data.id,
      ...paymentInvoice,
    }, 'Replace');

    return paymentInvoice;
  }

  async getInvoiceByHash(hash: string): Promise<PaymentInvoice | null> {
    try {
      const entities = await this.queryEntities(`hash eq '${hash}'`);
      return entities.length > 0 ? entities[0] : null;
    } catch (error) {
      throw new Error(`Failed to get invoice by hash: ${(error as Error).message}`);
    }
  }

  async markInvoiceAsPaid(id: string): Promise<PaymentInvoice> {
    const invoice = await this.getEntity('payment', id);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const updated: PaymentInvoice = {
      ...invoice,
      isPaid: true,
      paidAt: new Date(),
    };

    await this.tableClient.upsertEntity({
      partitionKey: 'payment',
      rowKey: id,
      ...updated,
    }, 'Replace');

    return updated;
  }

  async getInvoice(id: string): Promise<PaymentInvoice | null> {
    return this.getEntity('payment', id);
  }
}

export default new PaymentService(); 