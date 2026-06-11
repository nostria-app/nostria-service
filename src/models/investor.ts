export type InvestorStatus = 'active' | 'inactive';
export type RevenueSharePeriodStatus = 'draft' | 'calculated' | 'paid';
export type InvestorPayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface Investor {
  id: string;
  pubkey: string;
  npub?: string;
  displayName?: string;
  investmentCents: number;
  shareBasisPoints: number;
  sharePartsPerMillion: number;
  lightningAddress?: string;
  status: InvestorStatus;
  created: number;
  modified: number;
}

export interface InvestorInput {
  pubkey: string;
  npub?: string;
  displayName?: string;
  investmentCents?: number;
  shareBasisPoints?: number;
  sharePartsPerMillion?: number;
  lightningAddress?: string;
  status?: InvestorStatus;
}

export interface RevenueSharePeriod {
  id: string;
  period: string;
  grossRevenueCents: number;
  investorPoolCents: number;
  revenueShareBasisPoints: number;
  status: RevenueSharePeriodStatus;
  notes?: string;
  created: number;
  modified: number;
}

export interface InvestorPayout {
  id: string;
  investorPubkey: string;
  periodId: string;
  shareBasisPoints: number;
  sharePartsPerMillion: number;
  revenueCents: number;
  amountCents: number;
  amountSat?: number;
  lnInvoice?: string;
  lnPaymentHash?: string;
  nwcPreimage?: string;
  nwcResponse?: Record<string, unknown>;
  status: InvestorPayoutStatus;
  errorMessage?: string;
  paid?: number;
  created: number;
  modified: number;
  investor?: Investor;
  period?: RevenueSharePeriod;
}

export interface RevenueHistoryItem {
  period: string;
  grossRevenueCents: number;
  investorPoolCents: number;
  investorPayoutCents: number;
  status: RevenueSharePeriodStatus | 'estimated';
}

export interface InvestorDashboard {
  investor: Investor;
  totals: {
    paidPayoutsCents: number;
    pendingPayoutsCents: number;
    lifetimePayoutsCents: number;
    expectedMonthlyPayoutCents: number;
  };
  investmentStats: {
    investmentCents: number;
    shareBasisPoints: number;
    sharePartsPerMillion: number;
    ownershipPercentage: number;
    payoutMultiple: number;
  };
  revenueHistory: RevenueHistoryItem[];
  payouts: InvestorPayout[];
}

export interface InvestorAdminDashboard {
  totals: {
    investorCount: number;
    activeInvestorCount: number;
    totalInvestmentCents: number;
    totalShareBasisPoints: number;
    totalSharePartsPerMillion: number;
    currentMonthRevenueCents: number;
    currentMonthInvestorPoolCents: number;
    pendingPayoutsCents: number;
    paidPayoutsCents: number;
  };
  investors: Investor[];
  revenueHistory: RevenueHistoryItem[];
  recentPayouts: InvestorPayout[];
}
