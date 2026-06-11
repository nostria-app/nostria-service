export type InvestorStatus = 'active' | 'inactive';
export type RevenueSharePeriodStatus = 'draft' | 'calculated' | 'paid';
export type InvestorPayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface Investor {
  id: string;
  pubkey?: string;
  npub?: string | null;
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
  id?: string;
  pubkey?: string | null;
  npub?: string | null;
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
  investorId: string;
  investorPubkey?: string;
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

export interface PlatformStats {
  generatedAt: number;
  accounts: {
    total: number;
    free: number;
    paid: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    withUsername: number;
    newLast7Days: number;
    newLast30Days: number;
    activeLast7Days: number;
    activeLast30Days: number;
    tierCounts: Record<string, number>;
    activeTierCounts: Record<string, number>;
    expiredTierCounts: Record<string, number>;
    billingCycleCounts: Record<string, number>;
  };
  payments: {
    paidSubscriptionPayments: number;
    paidSubscriptionRevenueCents: number;
    averagePaidSubscriptionCents: number;
    currentMonthRevenueCents: number;
    last30DaysRevenueCents: number;
    last90DaysRevenueCents: number;
    last30DaysPayments: number;
    last90DaysPayments: number;
    tierRevenueCents: Record<string, number>;
    billingCycleRevenueCents: Record<string, number>;
    billingCyclePaymentCounts: Record<string, number>;
  };
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
  };
  platformStats: PlatformStats;
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
  platformStats: PlatformStats;
  revenueHistory: RevenueHistoryItem[];
  recentPayouts: InvestorPayout[];
}
