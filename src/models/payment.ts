import { BillingCycle, Tier } from "../config/types";

export const INVOICE_TTL = 15 * 60 * 1000; // 15 minutes

export interface Payment {
  id: string;
  type: 'payment'; // Document type for CosmosDB querying
  paymentType: 'ln'; // Renamed from 'type' to avoid conflict with document type

  // Lightning type props
  lnHash: string;
  lnInvoice: string;
  lnAmountSat: number;

  // Plan and payment status
  tier: Tier;
  billingCycle: BillingCycle;
  priceCents: number;
  isPaid: boolean;
  paidAt?: Date;
  expiresAt: Date;
  
  // User
  pubkey: string;
  
  updatedAt: Date;
  createdAt: Date;
}