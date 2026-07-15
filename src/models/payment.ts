import { BillingCycle, Tier } from "../config/types";

export const INVOICE_TTL = 15 * 60 * 1000; // 15 minutes

export type PaymentPurpose = 'subscription' | 'grok_topup';
export type PaymentBillingCycle = BillingCycle | 'one_time';
export type PaymentType = 'ln' | 'app-store' | 'play-store';

export interface Payment {
  id: string;
  type: 'payment'; // Document type for CosmosDB querying
  paymentType: PaymentType;

  // Lightning type props (placeholders for store payments)
  lnHash: string;
  lnInvoice: string;
  lnAmountSat: number;

  // Plan and payment status
  purpose?: PaymentPurpose;
  tier: Tier;
  billingCycle: PaymentBillingCycle;
  priceCents: number;
  creditNanosUsd?: number;
  isPaid: boolean;
  paid?: number;
  applied?: number;
  expires: number;

  // Native store identifiers (App Store / Play Store)
  storeTransactionId?: string;
  storeOriginalTransactionId?: string;
  storeProductId?: string;
  
  // User
  pubkey: string;
  
  created: number;
  modified: number;
}