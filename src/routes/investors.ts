import express, { Request, Response } from 'express';
import { nip19 } from 'nostr-tools';

import config from '../config';
import RepositoryFactory from '../database/RepositoryFactory';
import { now } from '../helpers/now';
import requireAdminAuth from '../middleware/requireAdminAuth';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import {
  Investor,
  InvestorAdminDashboard,
  InvestorDashboard,
  InvestorInput,
  InvestorPayout,
  InvestorStatus,
  PlatformStats,
  RevenueHistoryItem,
  RevenueSharePeriod,
} from '../models/investor';
import { Payment } from '../models/payment';
import nostrWalletConnectService from '../services/NostrWalletConnectService';
import logger from '../utils/logger';
import { NIP98AuthenticatedRequest } from './types';

const router = express.Router();
const accountRepository = RepositoryFactory.getAccountRepository();
const investorRepository = RepositoryFactory.getInvestorRepository();
const paymentRepository = RepositoryFactory.getPaymentRepository();
const DEFAULT_REVENUE_SHARE_BASIS_POINTS = 5000;
const SHARE_PARTS_PER_MILLION_TOTAL = 1_000_000;

interface InvestorSessionResponse {
  pubkey: string;
  role: 'admin' | 'investor' | 'none';
  investor?: Investor;
}

interface CalculateRevenueShareRequest {
  period?: string;
  revenueShareBasisPoints?: number;
  notes?: string;
}

interface PayInvestorPayoutRequest {
  lnInvoice?: string;
  amountSat?: number;
}

function isAdmin(pubkey: string): boolean {
  return Boolean(config.admin.pubkeys?.includes(pubkey));
}

function assertBasisPoints(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`${fieldName} must be an integer between 0 and 10000`);
  }
}

function assertSharePartsPerMillion(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0 || value > SHARE_PARTS_PER_MILLION_TOTAL) {
    throw new Error(`${fieldName} must be an integer between 0 and ${SHARE_PARTS_PER_MILLION_TOTAL}`);
  }
}

function assertCents(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function normalizeInvestorId(value: string): string {
  const id = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,99}$/.test(id)) {
    throw new Error('Investor ID must be 2-100 characters and use letters, numbers, dot, underscore, colon, or dash');
  }
  return id;
}

function normalizeInvestorInput(body: Partial<InvestorInput>): InvestorInput {
  const idInput = typeof body.id === 'string' ? body.id.trim() : '';
  const pubkeyInput = typeof body.pubkey === 'string' ? body.pubkey.trim() : '';
  const npubInput = typeof body.npub === 'string' ? body.npub.trim() : undefined;
  let pubkey: string | undefined = pubkeyInput || undefined;
  let npub = npubInput;

  if (pubkeyInput.startsWith('npub')) {
    const decoded = nip19.decode(pubkeyInput);
    if (typeof decoded.data !== 'string') {
      throw new Error('Invalid npub value');
    }
    pubkey = decoded.data;
    npub = pubkeyInput;
  }

  if (!pubkey && npubInput?.startsWith('npub')) {
    const decoded = nip19.decode(npubInput);
    if (typeof decoded.data !== 'string') {
      throw new Error('Invalid npub value');
    }
    pubkey = decoded.data;
    npub = npubInput;
  }

  if (pubkey && !/^[a-fA-F0-9]{64}$/.test(pubkey)) {
    throw new Error('Investor pubkey must be a 64-character hex pubkey or npub');
  }

  if (pubkey && !npub) {
    npub = nip19.npubEncode(pubkey.toLowerCase());
  }

  const id = idInput ? normalizeInvestorId(idInput) : pubkey ? `investor-${pubkey.toLowerCase()}` : '';
  if (!id) {
    throw new Error('Investor ID is required when no Nostr pubkey is provided');
  }

  const investmentCents = body.investmentCents ?? 0;
  const sharePartsPerMillion = body.sharePartsPerMillion ?? ((body.shareBasisPoints ?? 0) * 100);
  const shareBasisPoints = Math.round(sharePartsPerMillion / 100);
  assertCents(investmentCents, 'investmentCents');
  assertSharePartsPerMillion(sharePartsPerMillion, 'sharePartsPerMillion');

  const status = body.status || 'active';
  if (status !== 'active' && status !== 'inactive') {
    throw new Error('status must be active or inactive');
  }

  return {
    id,
    pubkey: pubkey?.toLowerCase(),
    npub,
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() || undefined : undefined,
    investmentCents,
    shareBasisPoints,
    sharePartsPerMillion,
    lightningAddress: typeof body.lightningAddress === 'string' ? body.lightningAddress.trim() || undefined : undefined,
    status,
  };
}

function normalizeInvestorUpdate(body: Partial<InvestorInput>): Partial<InvestorInput> {
  const update: Partial<InvestorInput> = {};

  if (body.pubkey !== undefined) {
    const pubkeyInput = typeof body.pubkey === 'string' ? body.pubkey.trim() : '';
    if (!pubkeyInput) {
      update.pubkey = null;
      update.npub = null;
    } else if (pubkeyInput.startsWith('npub')) {
      const decoded = nip19.decode(pubkeyInput);
      if (typeof decoded.data !== 'string') {
        throw new Error('Invalid npub value');
      }
      update.pubkey = decoded.data.toLowerCase();
      update.npub = pubkeyInput;
    } else {
      if (!/^[a-fA-F0-9]{64}$/.test(pubkeyInput)) {
        throw new Error('Investor pubkey must be a 64-character hex pubkey or npub');
      }
      update.pubkey = pubkeyInput.toLowerCase();
      update.npub = body.npub === undefined ? nip19.npubEncode(pubkeyInput.toLowerCase()) : update.npub;
    }
  }

  if (body.npub !== undefined) {
    const npubInput = typeof body.npub === 'string' ? body.npub.trim() : '';
    update.npub = npubInput || undefined;
  }

  if (body.displayName !== undefined) {
    update.displayName = typeof body.displayName === 'string' ? body.displayName.trim() || undefined : undefined;
  }

  if (body.investmentCents !== undefined) {
    assertCents(body.investmentCents, 'investmentCents');
    update.investmentCents = body.investmentCents;
  }

  if (body.shareBasisPoints !== undefined) {
    assertBasisPoints(body.shareBasisPoints, 'shareBasisPoints');
    update.shareBasisPoints = body.shareBasisPoints;
    update.sharePartsPerMillion = body.shareBasisPoints * 100;
  }

  if (body.sharePartsPerMillion !== undefined) {
    assertSharePartsPerMillion(body.sharePartsPerMillion, 'sharePartsPerMillion');
    update.sharePartsPerMillion = body.sharePartsPerMillion;
    update.shareBasisPoints = Math.round(body.sharePartsPerMillion / 100);
  }

  if (body.lightningAddress !== undefined) {
    update.lightningAddress = typeof body.lightningAddress === 'string' ? body.lightningAddress.trim() || undefined : undefined;
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      throw new Error('status must be active or inactive');
    }
    update.status = body.status as InvestorStatus;
  }

  return update;
}

function getPeriodBounds(period: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new Error('period must use YYYY-MM format');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new Error('period month must be between 01 and 12');
  }

  return {
    start: Date.UTC(year, month - 1, 1),
    end: Date.UTC(year, month, 1),
  };
}

function getCurrentPeriod(): string {
  const date = new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getRecentPeriods(count: number): string[] {
  const periods: string[] = [];
  const date = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  for (let index = 0; index < count; index += 1) {
    periods.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    date.setUTCMonth(date.getUTCMonth() - 1);
  }

  return periods;
}

async function calculatePaidRevenueCents(period: string): Promise<number> {
  const bounds = getPeriodBounds(period);
  const payments = await paymentRepository.getPaidSubscriptionPaymentsBetween(bounds.start, bounds.end) as Payment[];
  return payments.reduce((total, payment) => total + payment.priceCents, 0);
}

function calculateInvestorPool(grossRevenueCents: number, revenueShareBasisPoints: number): number {
  return Math.round((grossRevenueCents * revenueShareBasisPoints) / 10000);
}

function calculateInvestorPayout(poolCents: number, sharePartsPerMillion: number): number {
  return Math.round((poolCents * sharePartsPerMillion) / SHARE_PARTS_PER_MILLION_TOTAL);
}

async function getPlatformStats(): Promise<PlatformStats> {
  const [accounts, payments] = await Promise.all([
    accountRepository.getAccountStats(),
    paymentRepository.getSubscriptionPaymentStats(),
  ]);

  return {
    generatedAt: now(),
    accounts,
    payments,
  };
}

async function getRevenueHistory(investor?: Investor): Promise<RevenueHistoryItem[]> {
  const periods = await investorRepository.listRevenueSharePeriods(24) as RevenueSharePeriod[];
  const periodMap = new Map(periods.map(period => [period.period, period]));
  const payouts = investor
    ? await investorRepository.listPayoutsByInvestor(investor.id, 250) as InvestorPayout[]
    : [];
  const payoutMap = new Map(payouts.map(payout => [payout.period?.period || '', payout]));
  const history: RevenueHistoryItem[] = [];

  for (const period of getRecentPeriods(12)) {
    const existingPeriod = periodMap.get(period);

    if (existingPeriod) {
      const payout = payoutMap.get(period);
      history.push({
        period,
        grossRevenueCents: existingPeriod.grossRevenueCents,
        investorPoolCents: existingPeriod.investorPoolCents,
        investorPayoutCents: investor ? payout?.amountCents || 0 : existingPeriod.investorPoolCents,
        status: existingPeriod.status,
      });
      continue;
    }

    const grossRevenueCents = await calculatePaidRevenueCents(period);
    const investorPoolCents = calculateInvestorPool(grossRevenueCents, DEFAULT_REVENUE_SHARE_BASIS_POINTS);
    history.push({
      period,
      grossRevenueCents,
      investorPoolCents,
      investorPayoutCents: investor ? calculateInvestorPayout(investorPoolCents, investor.sharePartsPerMillion) : investorPoolCents,
      status: 'estimated',
    });
  }

  return history;
}

async function buildInvestorDashboard(investor: Investor): Promise<InvestorDashboard> {
  const payouts = await investorRepository.listPayoutsByInvestor(investor.id, 100) as InvestorPayout[];
  const paidPayoutsCents = payouts
    .filter(payout => payout.status === 'paid')
    .reduce((total, payout) => total + payout.amountCents, 0);
  const pendingPayoutsCents = payouts
    .filter(payout => payout.status !== 'paid')
    .reduce((total, payout) => total + payout.amountCents, 0);
  const currentRevenueCents = await calculatePaidRevenueCents(getCurrentPeriod());
  const currentPoolCents = calculateInvestorPool(currentRevenueCents, DEFAULT_REVENUE_SHARE_BASIS_POINTS);
  const expectedMonthlyPayoutCents = calculateInvestorPayout(currentPoolCents, investor.sharePartsPerMillion);

  return {
    investor,
    totals: {
      paidPayoutsCents,
      pendingPayoutsCents,
      lifetimePayoutsCents: paidPayoutsCents + pendingPayoutsCents,
      expectedMonthlyPayoutCents,
    },
    investmentStats: {
      investmentCents: investor.investmentCents,
      shareBasisPoints: investor.shareBasisPoints,
      sharePartsPerMillion: investor.sharePartsPerMillion,
      ownershipPercentage: investor.sharePartsPerMillion / 10000,
    },
    platformStats: await getPlatformStats(),
    revenueHistory: await getRevenueHistory(investor),
    payouts,
  };
}

async function buildAdminDashboard(): Promise<InvestorAdminDashboard> {
  const investors = await investorRepository.listInvestors(true) as Investor[];
  const activeInvestors = investors.filter(investor => investor.status === 'active');
  const recentPayouts = await investorRepository.listRecentPayouts(100) as InvestorPayout[];
  const currentMonthRevenueCents = await calculatePaidRevenueCents(getCurrentPeriod());
  const currentMonthInvestorPoolCents = calculateInvestorPool(currentMonthRevenueCents, DEFAULT_REVENUE_SHARE_BASIS_POINTS);

  return {
    totals: {
      investorCount: investors.length,
      activeInvestorCount: activeInvestors.length,
      totalInvestmentCents: investors.reduce((total, investor) => total + investor.investmentCents, 0),
      totalShareBasisPoints: Math.round(activeInvestors.reduce((total, investor) => total + investor.sharePartsPerMillion, 0) / 100),
      totalSharePartsPerMillion: activeInvestors.reduce((total, investor) => total + investor.sharePartsPerMillion, 0),
      currentMonthRevenueCents,
      currentMonthInvestorPoolCents,
      pendingPayoutsCents: recentPayouts
        .filter(payout => payout.status !== 'paid')
        .reduce((total, payout) => total + payout.amountCents, 0),
      paidPayoutsCents: recentPayouts
        .filter(payout => payout.status === 'paid')
        .reduce((total, payout) => total + payout.amountCents, 0),
    },
    investors,
    platformStats: await getPlatformStats(),
    revenueHistory: await getRevenueHistory(),
    recentPayouts,
  };
}

router.get('/session', requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response<InvestorSessionResponse | { error: string }>) => {
  try {
    const pubkey = req.authenticatedPubkey;
    if (!pubkey) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isAdmin(pubkey)) {
      return res.json({ pubkey, role: 'admin' });
    }

    const investor = await investorRepository.getInvestorByPubkey(pubkey) as Investor | null;
    if (investor?.status === 'active') {
      return res.json({ pubkey, role: 'investor', investor });
    }

    return res.json({ pubkey, role: 'none' });
  } catch (error) {
    logger.error('Failed to resolve investor session:', error);
    return res.status(500).json({ error: 'Failed to resolve session' });
  }
});

router.get('/me/dashboard', requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response<InvestorDashboard | { error: string }>) => {
  try {
    const pubkey = req.authenticatedPubkey;
    if (!pubkey) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const investor = await investorRepository.getInvestorByPubkey(pubkey) as Investor | null;
    if (!investor || investor.status !== 'active') {
      return res.status(403).json({ error: 'Investor access required' });
    }

    return res.json(await buildInvestorDashboard(investor));
  } catch (error) {
    logger.error('Failed to load investor dashboard:', error);
    return res.status(500).json({ error: 'Failed to load investor dashboard' });
  }
});

router.get('/admin/dashboard', requireAdminAuth, async (_req: NIP98AuthenticatedRequest, res: Response<InvestorAdminDashboard | { error: string }>) => {
  try {
    return res.json(await buildAdminDashboard());
  } catch (error) {
    logger.error('Failed to load investor admin dashboard:', error);
    return res.status(500).json({ error: 'Failed to load investor admin dashboard' });
  }
});

router.get('/admin/investors', requireAdminAuth, async (_req: NIP98AuthenticatedRequest, res: Response<Investor[] | { error: string }>) => {
  try {
    const investors = await investorRepository.listInvestors(true) as Investor[];
    return res.json(investors);
  } catch (error) {
    logger.error('Failed to list investors:', error);
    return res.status(500).json({ error: 'Failed to list investors' });
  }
});

router.post('/admin/investors', requireAdminAuth, async (req: Request<{}, {}, InvestorInput>, res: Response<Investor | { error: string }>) => {
  try {
    const input = normalizeInvestorInput(req.body);
    const investor = await investorRepository.createInvestor(input) as Investor;
    return res.status(201).json(investor);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create investor';
    logger.warn('Failed to create investor:', error);
    return res.status(400).json({ error: message });
  }
});

router.put('/admin/investors/:id', requireAdminAuth, async (req: Request<{ id: string }, {}, Partial<InvestorInput>>, res: Response<Investor | { error: string }>) => {
  try {
    const update = normalizeInvestorUpdate(req.body);
    const investor = await investorRepository.updateInvestor(req.params.id, update) as Investor;
    return res.json(investor);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update investor';
    logger.warn('Failed to update investor:', error);
    return res.status(400).json({ error: message });
  }
});

router.delete('/admin/investors/:id', requireAdminAuth, async (req: Request<{ id: string }>, res: Response<{ success: boolean } | { error: string }>) => {
  try {
    await investorRepository.deleteInvestor(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete investor:', error);
    return res.status(500).json({ error: 'Failed to delete investor' });
  }
});

router.get('/admin/periods', requireAdminAuth, async (req: Request, res: Response<RevenueSharePeriod[] | { error: string }>) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 100);
    const periods = await investorRepository.listRevenueSharePeriods(limit) as RevenueSharePeriod[];
    return res.json(periods);
  } catch (error) {
    logger.error('Failed to list revenue share periods:', error);
    return res.status(500).json({ error: 'Failed to list revenue share periods' });
  }
});

router.post('/admin/periods/calculate', requireAdminAuth, async (req: Request<{}, {}, CalculateRevenueShareRequest>, res: Response<{ period: RevenueSharePeriod; payouts: InvestorPayout[] } | { error: string }>) => {
  try {
    const period = req.body.period || getCurrentPeriod();
    const revenueShareBasisPoints = req.body.revenueShareBasisPoints ?? DEFAULT_REVENUE_SHARE_BASIS_POINTS;
    assertBasisPoints(revenueShareBasisPoints, 'revenueShareBasisPoints');

    const grossRevenueCents = await calculatePaidRevenueCents(period);
    const investorPoolCents = calculateInvestorPool(grossRevenueCents, revenueShareBasisPoints);
    const revenueSharePeriod = await investorRepository.upsertRevenueSharePeriod({
      period,
      grossRevenueCents,
      investorPoolCents,
      revenueShareBasisPoints,
      status: 'calculated',
      notes: req.body.notes,
    }) as RevenueSharePeriod;
    const investors = await investorRepository.listInvestors(false) as Investor[];
    const payouts: InvestorPayout[] = [];

    for (const investor of investors) {
      const existing = await investorRepository.getPayoutByInvestorAndPeriod(investor.id, revenueSharePeriod.id) as InvestorPayout | null;
      if (existing?.status === 'paid') {
        payouts.push(existing);
        continue;
      }

      const payout = await investorRepository.upsertPayout({
        investorId: investor.id,
        investorPubkey: investor.pubkey,
        periodId: revenueSharePeriod.id,
        shareBasisPoints: investor.shareBasisPoints,
        sharePartsPerMillion: investor.sharePartsPerMillion,
        revenueCents: investorPoolCents,
        amountCents: calculateInvestorPayout(investorPoolCents, investor.sharePartsPerMillion),
      }) as InvestorPayout;
      payouts.push(payout);
    }

    return res.json({ period: revenueSharePeriod, payouts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to calculate revenue share';
    logger.error('Failed to calculate investor revenue share:', error);
    return res.status(400).json({ error: message });
  }
});

router.post('/admin/payouts/:id/pay', requireAdminAuth, async (req: Request<{ id: string }, {}, PayInvestorPayoutRequest>, res: Response<InvestorPayout | { error: string }>) => {
  try {
    const payout = await investorRepository.getPayoutById(req.params.id) as InvestorPayout | null;
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    if (payout.status === 'paid') {
      return res.json(payout);
    }

    const invoice = req.body.lnInvoice || payout.lnInvoice;
    if (!invoice) {
      return res.status(400).json({ error: 'lnInvoice is required to pay investor payout' });
    }

    await investorRepository.updatePayout(payout.id, {
      status: 'processing',
      lnInvoice: invoice,
      amountSat: req.body.amountSat,
      errorMessage: null,
    });

    try {
      const result = await nostrWalletConnectService.payInvoice(invoice);
      const paidPayout = await investorRepository.updatePayout(payout.id, {
        status: 'paid',
        lnInvoice: invoice,
        amountSat: req.body.amountSat,
        lnPaymentHash: result.paymentHash,
        nwcPreimage: result.preimage,
        nwcResponse: result.response,
        paid: now(),
        errorMessage: null,
      }) as InvestorPayout;

      const periodPayouts = await investorRepository.listPayoutsByPeriod(payout.periodId) as InvestorPayout[];
      if (periodPayouts.length > 0 && periodPayouts.every(item => item.status === 'paid')) {
        await investorRepository.updateRevenueSharePeriodStatus(payout.periodId, 'paid');
      }

      return res.json(paidPayout);
    } catch (paymentError) {
      const message = paymentError instanceof Error ? paymentError.message : 'NWC payment failed';
      const failedPayout = await investorRepository.updatePayout(payout.id, {
        status: 'failed',
        lnInvoice: invoice,
        amountSat: req.body.amountSat,
        errorMessage: message,
      }) as InvestorPayout;

      return res.status(502).json({ error: failedPayout.errorMessage || message });
    }
  } catch (error) {
    logger.error('Failed to pay investor payout:', error);
    return res.status(500).json({ error: 'Failed to pay investor payout' });
  }
});

router.get('/nwc/status', requireAdminAuth, (_req: NIP98AuthenticatedRequest, res: Response<{ configured: boolean }>) => {
  return res.json({ configured: nostrWalletConnectService.isConfigured() });
});

export default router;
