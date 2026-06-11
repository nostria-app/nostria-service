import { v4 as uuidv4 } from 'uuid';

import {
  Investor,
  InvestorInput,
  InvestorPayout,
  InvestorPayoutStatus,
  RevenueSharePeriod,
} from '../models/investor';
import { now } from '../helpers/now';
import logger from '../utils/logger';
import { PrismaBaseRepository } from './PrismaBaseRepository';

class PrismaInvestorRepository extends PrismaBaseRepository {
  constructor() {
    super('investor');
  }

  private transformInvestor(prismaInvestor: any): Investor {
    return {
      id: prismaInvestor.id,
      pubkey: prismaInvestor.pubkey,
      npub: prismaInvestor.npub || undefined,
      displayName: prismaInvestor.displayName || undefined,
      investmentCents: prismaInvestor.investmentCents,
      shareBasisPoints: prismaInvestor.shareBasisPoints,
      sharePartsPerMillion: prismaInvestor.sharePartsPerMillion,
      lightningAddress: prismaInvestor.lightningAddress || undefined,
      status: prismaInvestor.status,
      created: Number(prismaInvestor.created),
      modified: Number(prismaInvestor.modified),
    };
  }

  private transformPeriod(prismaPeriod: any): RevenueSharePeriod {
    return {
      id: prismaPeriod.id,
      period: prismaPeriod.period,
      grossRevenueCents: prismaPeriod.grossRevenueCents,
      investorPoolCents: prismaPeriod.investorPoolCents,
      revenueShareBasisPoints: prismaPeriod.revenueShareBasisPoints,
      status: prismaPeriod.status,
      notes: prismaPeriod.notes || undefined,
      created: Number(prismaPeriod.created),
      modified: Number(prismaPeriod.modified),
    };
  }

  private transformPayout(prismaPayout: any): InvestorPayout {
    return {
      id: prismaPayout.id,
      investorPubkey: prismaPayout.investorPubkey,
      periodId: prismaPayout.periodId,
      shareBasisPoints: prismaPayout.shareBasisPoints,
      sharePartsPerMillion: prismaPayout.sharePartsPerMillion,
      revenueCents: prismaPayout.revenueCents,
      amountCents: prismaPayout.amountCents,
      amountSat: prismaPayout.amountSat || undefined,
      lnInvoice: prismaPayout.lnInvoice || undefined,
      lnPaymentHash: prismaPayout.lnPaymentHash || undefined,
      nwcPreimage: prismaPayout.nwcPreimage || undefined,
      nwcResponse: prismaPayout.nwcResponse || undefined,
      status: prismaPayout.status,
      errorMessage: prismaPayout.errorMessage || undefined,
      paid: prismaPayout.paid ? Number(prismaPayout.paid) : undefined,
      created: Number(prismaPayout.created),
      modified: Number(prismaPayout.modified),
      investor: prismaPayout.investor ? this.transformInvestor(prismaPayout.investor) : undefined,
      period: prismaPayout.period ? this.transformPeriod(prismaPayout.period) : undefined,
    };
  }

  async listInvestors(includeInactive = false): Promise<Investor[]> {
    try {
      const results = await this.prisma.investor.findMany({
        where: includeInactive ? undefined : { status: 'active' },
        orderBy: [
          { status: 'asc' },
          { sharePartsPerMillion: 'desc' },
          { created: 'asc' },
        ],
      });

      return results.map((result: any) => this.transformInvestor(result));
    } catch (error) {
      logger.error('Failed to list investors:', error);
      throw new Error(`Failed to list investors: ${(error as Error).message}`);
    }
  }

  async getInvestorByPubkey(pubkey: string): Promise<Investor | null> {
    try {
      const result = await this.prisma.investor.findUnique({
        where: { pubkey },
      });

      return result ? this.transformInvestor(result) : null;
    } catch (error) {
      logger.error('Failed to get investor:', error);
      throw new Error(`Failed to get investor: ${(error as Error).message}`);
    }
  }

  async createInvestor(input: InvestorInput): Promise<Investor> {
    try {
      const ts = now();
      const result = await this.prisma.investor.create({
        data: {
          id: `investor-${input.pubkey}`,
          pubkey: input.pubkey,
          npub: input.npub || null,
          displayName: input.displayName || null,
          investmentCents: input.investmentCents || 0,
          shareBasisPoints: input.shareBasisPoints || 0,
          sharePartsPerMillion: input.sharePartsPerMillion || 0,
          lightningAddress: input.lightningAddress || null,
          status: input.status || 'active',
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      return this.transformInvestor(result);
    } catch (error) {
      this.handlePrismaError(error, 'create');
    }
  }

  async updateInvestor(pubkey: string, input: Partial<InvestorInput>): Promise<Investor> {
    try {
      const result = await this.prisma.investor.update({
        where: { pubkey },
        data: {
          npub: input.npub,
          displayName: input.displayName,
          investmentCents: input.investmentCents,
          shareBasisPoints: input.shareBasisPoints,
          sharePartsPerMillion: input.sharePartsPerMillion,
          lightningAddress: input.lightningAddress,
          status: input.status,
          modified: BigInt(now()),
        },
      });

      return this.transformInvestor(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async deleteInvestor(pubkey: string): Promise<void> {
    try {
      await this.prisma.investor.delete({
        where: { pubkey },
      });
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  async upsertRevenueSharePeriod(input: {
    period: string;
    grossRevenueCents: number;
    investorPoolCents: number;
    revenueShareBasisPoints: number;
    status: RevenueSharePeriod['status'];
    notes?: string;
  }): Promise<RevenueSharePeriod> {
    try {
      const ts = now();
      const result = await this.prisma.revenueSharePeriod.upsert({
        where: { period: input.period },
        create: {
          id: uuidv4(),
          period: input.period,
          grossRevenueCents: input.grossRevenueCents,
          investorPoolCents: input.investorPoolCents,
          revenueShareBasisPoints: input.revenueShareBasisPoints,
          status: input.status,
          notes: input.notes || null,
          created: BigInt(ts),
          modified: BigInt(ts),
        },
        update: {
          grossRevenueCents: input.grossRevenueCents,
          investorPoolCents: input.investorPoolCents,
          revenueShareBasisPoints: input.revenueShareBasisPoints,
          status: input.status,
          notes: input.notes || null,
          modified: BigInt(ts),
        },
      });

      return this.transformPeriod(result);
    } catch (error) {
      this.handlePrismaError(error, 'upsert revenue share period');
    }
  }

  async listRevenueSharePeriods(limit = 24): Promise<RevenueSharePeriod[]> {
    try {
      const results = await this.prisma.revenueSharePeriod.findMany({
        orderBy: { period: 'desc' },
        take: limit,
      });

      return results.map((result: any) => this.transformPeriod(result));
    } catch (error) {
      logger.error('Failed to list revenue share periods:', error);
      throw new Error(`Failed to list revenue share periods: ${(error as Error).message}`);
    }
  }

  async updateRevenueSharePeriodStatus(id: string, status: RevenueSharePeriod['status']): Promise<RevenueSharePeriod> {
    try {
      const result = await this.prisma.revenueSharePeriod.update({
        where: { id },
        data: {
          status,
          modified: BigInt(now()),
        },
      });

      return this.transformPeriod(result);
    } catch (error) {
      this.handlePrismaError(error, 'update revenue share period status');
    }
  }

  async upsertPayout(input: {
    investorPubkey: string;
    periodId: string;
    shareBasisPoints: number;
    sharePartsPerMillion: number;
    revenueCents: number;
    amountCents: number;
  }): Promise<InvestorPayout> {
    try {
      const ts = now();
      const result = await this.prisma.investorPayout.upsert({
        where: {
          investorPubkey_periodId: {
            investorPubkey: input.investorPubkey,
            periodId: input.periodId,
          },
        },
        create: {
          id: uuidv4(),
          investorPubkey: input.investorPubkey,
          periodId: input.periodId,
          shareBasisPoints: input.shareBasisPoints,
          sharePartsPerMillion: input.sharePartsPerMillion,
          revenueCents: input.revenueCents,
          amountCents: input.amountCents,
          status: 'pending',
          created: BigInt(ts),
          modified: BigInt(ts),
        },
        update: {
          shareBasisPoints: input.shareBasisPoints,
          sharePartsPerMillion: input.sharePartsPerMillion,
          revenueCents: input.revenueCents,
          amountCents: input.amountCents,
          modified: BigInt(ts),
        },
        include: {
          investor: true,
          period: true,
        },
      });

      return this.transformPayout(result);
    } catch (error) {
      this.handlePrismaError(error, 'upsert payout');
    }
  }

  async getPayoutById(id: string): Promise<InvestorPayout | null> {
    try {
      const result = await this.prisma.investorPayout.findUnique({
        where: { id },
        include: {
          investor: true,
          period: true,
        },
      });

      return result ? this.transformPayout(result) : null;
    } catch (error) {
      logger.error('Failed to get investor payout:', error);
      throw new Error(`Failed to get investor payout: ${(error as Error).message}`);
    }
  }

  async getPayoutByInvestorAndPeriod(investorPubkey: string, periodId: string): Promise<InvestorPayout | null> {
    try {
      const result = await this.prisma.investorPayout.findUnique({
        where: {
          investorPubkey_periodId: {
            investorPubkey,
            periodId,
          },
        },
        include: {
          investor: true,
          period: true,
        },
      });

      return result ? this.transformPayout(result) : null;
    } catch (error) {
      logger.error('Failed to get investor payout by period:', error);
      throw new Error(`Failed to get investor payout: ${(error as Error).message}`);
    }
  }

  async updatePayout(id: string, input: {
    amountSat?: number;
    lnInvoice?: string;
    lnPaymentHash?: string;
    nwcPreimage?: string;
    nwcResponse?: Record<string, unknown>;
    status?: InvestorPayoutStatus;
    errorMessage?: string | null;
    paid?: number;
  }): Promise<InvestorPayout> {
    try {
      const result = await this.prisma.investorPayout.update({
        where: { id },
        data: {
          amountSat: input.amountSat,
          lnInvoice: input.lnInvoice,
          lnPaymentHash: input.lnPaymentHash,
          nwcPreimage: input.nwcPreimage,
          nwcResponse: input.nwcResponse as any,
          status: input.status,
          errorMessage: input.errorMessage === undefined ? undefined : input.errorMessage,
          paid: input.paid ? BigInt(input.paid) : undefined,
          modified: BigInt(now()),
        },
        include: {
          investor: true,
          period: true,
        },
      });

      return this.transformPayout(result);
    } catch (error) {
      this.handlePrismaError(error, 'update payout');
    }
  }

  async listPayoutsByInvestor(pubkey: string, limit = 100): Promise<InvestorPayout[]> {
    try {
      const results = await this.prisma.investorPayout.findMany({
        where: { investorPubkey: pubkey },
        include: {
          investor: true,
          period: true,
        },
        orderBy: { created: 'desc' },
        take: limit,
      });

      return results.map((result: any) => this.transformPayout(result));
    } catch (error) {
      logger.error('Failed to list investor payouts:', error);
      throw new Error(`Failed to list investor payouts: ${(error as Error).message}`);
    }
  }

  async listPayoutsByPeriod(periodId: string): Promise<InvestorPayout[]> {
    try {
      const results = await this.prisma.investorPayout.findMany({
        where: { periodId },
        include: {
          investor: true,
          period: true,
        },
        orderBy: { created: 'asc' },
      });

      return results.map((result: any) => this.transformPayout(result));
    } catch (error) {
      logger.error('Failed to list investor payouts by period:', error);
      throw new Error(`Failed to list investor payouts: ${(error as Error).message}`);
    }
  }

  async listRecentPayouts(limit = 50): Promise<InvestorPayout[]> {
    try {
      const results = await this.prisma.investorPayout.findMany({
        include: {
          investor: true,
          period: true,
        },
        orderBy: { created: 'desc' },
        take: limit,
      });

      return results.map((result: any) => this.transformPayout(result));
    } catch (error) {
      logger.error('Failed to list recent investor payouts:', error);
      throw new Error(`Failed to list recent investor payouts: ${(error as Error).message}`);
    }
  }
}

export default PrismaInvestorRepository;
