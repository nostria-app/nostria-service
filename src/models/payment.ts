import { BillingCycle, Tier } from "../config/types";

export const INVOICE_TTL = 15 * 60 * 1000; // 15 minutes

export type PaymentPurpose = 'subscription' | 'grok_topup';
export type PaymentBillingCycle = BillingCycle | 'one_time';

export interface Payment {
  id: string;
  type: 'payment'; // Document type for CosmosDB querying
  paymentType: 'ln'; // Renamed from 'type' to avoid conflict with document type

  // Lightning type props
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
  
  // User
  pubkey: string;
  
  created: number;
  modified: number;
}