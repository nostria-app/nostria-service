import { Payment } from "../models/payment";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PrismaPaymentRepository extends PrismaBaseRepository {
  constructor() {
    super('payment');
  }

  private transformPrismaPaymentToPayment(prismaPayment: any): Payment {
    return {
      id: prismaPayment.id,
      type: 'payment',
      paymentType: prismaPayment.paymentType,
      lnHash: prismaPayment.lnHash,
      lnInvoice: prismaPayment.lnInvoice,
      lnAmountSat: prismaPayment.lnAmountSat,
      tier: prismaPayment.tier,
      billingCycle: prismaPayment.billingCycle,
      priceCents: prismaPayment.priceCents,
      isPaid: prismaPayment.isPaid,
      paid: prismaPayment.paid ? Number(prismaPayment.paid) : undefined,
      expires: Number(prismaPayment.expires),
      pubkey: prismaPayment.pubkey,
      created: Number(prismaPayment.created),
      modified: Number(prismaPayment.modified),
    };
  }

  async create(payment: Payment): Promise<Payment> {
    try {
      const paymentData = {
        id: payment.id,
        paymentType: payment.paymentType,
        lnHash: payment.lnHash,
        lnInvoice: payment.lnInvoice,
        lnAmountSat: payment.lnAmountSat,
        tier: payment.tier,
        billingCycle: payment.billingCycle,
        priceCents: payment.priceCents,
        isPaid: payment.isPaid,
        paid: payment.paid ? BigInt(payment.paid) : null,
        expires: BigInt(payment.expires),
        pubkey: payment.pubkey,
        created: BigInt(payment.created),
        modified: BigInt(payment.modified),
      };

      const result = await this.prisma.payment.create({
        data: paymentData
      });

      logger.info(`Created payment: ${payment.id}`);
      return this.transformPrismaPaymentToPayment(result);
    } catch (error) {
      this.handlePrismaError(error, 'create');
    }
  }

  async update(payment: Payment): Promise<Payment> {
    try {
      const paymentData = {
        paymentType: payment.paymentType,
        lnHash: payment.lnHash,
        lnInvoice: payment.lnInvoice,
        lnAmountSat: payment.lnAmountSat,
        tier: payment.tier,
        billingCycle: payment.billingCycle,
        priceCents: payment.priceCents,
        isPaid: payment.isPaid,
        paid: payment.paid ? BigInt(payment.paid) : null,
        expires: BigInt(payment.expires),
        modified: BigInt(payment.modified || now()),
      };

      const result = await this.prisma.payment.update({
        where: { id: payment.id },
        data: paymentData
      });

      logger.info(`Updated payment: ${payment.id}`);
      return this.transformPrismaPaymentToPayment(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async get(id: string, pubkey: string): Promise<Payment | null> {
    try {
      const result = await this.prisma.payment.findFirst({
        where: { 
          id: id,
          pubkey: pubkey 
        }
      });

      return result ? this.transformPrismaPaymentToPayment(result) : null;
    } catch (error) {
      logger.error('Failed to get payment by id:', error);
      throw new Error(`Failed to get payment: ${(error as Error).message}`);
    }
  }

  async getAllPayments(limit: number = 100): Promise<Payment[]> {
    try {
      const results = await this.prisma.payment.findMany({
        orderBy: { created: 'desc' },
        take: limit
      });

      return results.map((result: any) => this.transformPrismaPaymentToPayment(result));
    } catch (error) {
      logger.error('Failed to get all payments:', error);
      throw new Error(`Failed to get payments: ${(error as Error).message}`);
    }
  }

  async getPaymentsByPubkey(pubkey: string, limit: number = 50): Promise<Payment[]> {
    try {
      const results = await this.prisma.payment.findMany({
        where: { pubkey },
        orderBy: { created: 'desc' },
        take: limit
      });

      return results.map((result: any) => this.transformPrismaPaymentToPayment(result));
    } catch (error) {
      logger.error('Failed to get payments by pubkey:', error);
      throw new Error(`Failed to get payments: ${(error as Error).message}`);
    }
  }

  async deletePayment(id: string, pubkey: string): Promise<void> {
    try {
      await this.prisma.payment.delete({
        where: { id }
      });

      logger.info(`Deleted payment: ${id}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  // Additional helper methods
  async getUnpaidPayments(limit: number = 100): Promise<Payment[]> {
    try {
      const results = await this.prisma.payment.findMany({
        where: { isPaid: false },
        orderBy: { created: 'asc' },
        take: limit
      });

      return results.map((result: any) => this.transformPrismaPaymentToPayment(result));
    } catch (error) {
      logger.error('Failed to get unpaid payments:', error);
      throw new Error(`Failed to get unpaid payments: ${(error as Error).message}`);
    }
  }

  async getExpiredPayments(): Promise<Payment[]> {
    try {
      const results = await this.prisma.payment.findMany({
        where: {
          expires: {
            lt: BigInt(now())
          },
          isPaid: false
        }
      });

      return results.map((result: any) => this.transformPrismaPaymentToPayment(result));
    } catch (error) {
      logger.error('Failed to get expired payments:', error);
      throw new Error(`Failed to get expired payments: ${(error as Error).message}`);
    }
  }
}

export default PrismaPaymentRepository;