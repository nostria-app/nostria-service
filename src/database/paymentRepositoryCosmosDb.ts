import { Payment } from "../models/payment";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PaymentRepository extends CosmosDbBaseRepository<Payment> {
  constructor() {
    super('payment', true);
  }
  async create(payment: Payment): Promise<Payment> {
    // Use payment ID as partition key for efficient queries
    const paymentEntity: Payment = {
      ...payment,
      type: 'payment'
    };

    return await super.create(paymentEntity);
  }

  async update(payment: Payment): Promise<Payment> {
    try {
      return await super.update(payment);
    } catch (error) {
      logger.error('Failed to update payment:', error);
      throw new Error(`Failed to update payment: ${(error as Error).message}`);
    }
  }
  async get(id: string, pubkey: string): Promise<Payment | null> {
    try {
      return await this.getById(id, pubkey);
    } catch (error) {
      logger.error('Failed to get payment:', error);
      throw new Error(`Failed to get payment: ${(error as Error).message}`);
    }
  }

  async getByLnHash(lnHash: string): Promise<Payment | null> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.lnHash = @lnHash',
        parameters: [
          { name: '@type', value: 'payment' },
          { name: '@lnHash', value: lnHash }
        ]
      };

      const entities = await this.query(query);
      return entities.length > 0 ? entities[0] : null;
    } catch (error) {
      logger.error('Failed to get payment by ln hash:', error);
      throw new Error(`Failed to get payment: ${(error as Error).message}`);
    }
  }

  async getExpiredPayments(): Promise<Payment[]> {
    try {
      const now = new Date();
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.expires < @now AND c.isPaid = @isPaid',
        parameters: [
          { name: '@type', value: 'payment' },
          { name: '@now', value: now.toISOString() },
          { name: '@isPaid', value: false }
        ]
      };

      return await this.query(query);
    } catch (error) {
      logger.error('Failed to get expired payments:', error);
      throw new Error(`Failed to get expired payments: ${(error as Error).message}`);
    }
  }

  async getPaymentsByUser(pubkey: string, limit: number = 50): Promise<Payment[]> {
    try {
      // Since we don't have pubkey directly in the payment model, 
      // this would need to be added if we want to query payments by user
      // For now, we'll return an empty array and note this limitation
      logger.warn('getPaymentsByUser not implemented - payment model needs pubkey field');
      return [];
    } catch (error) {
      logger.error('Failed to get payments by user:', error);
      throw new Error(`Failed to get payments: ${(error as Error).message}`);
    }
  }

  async deletePayment(id: string, pubkey: string): Promise<void> {
    try {
      await super.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete payment:', error);
      throw new Error(`Failed to delete payment: ${(error as Error).message}`);
    }
  }

  async markAsPaid(id: string, pubkey: string, paid: number = now()): Promise<Payment> {
    try {
      const payment = await this.get(id, pubkey);
      if (!payment) {
        throw new Error('Payment not found');
      }

      payment.isPaid = true;
      payment.paid = paid;

      return await this.update(payment);
    } catch (error) {
      logger.error('Failed to mark payment as paid:', error);
      throw new Error(`Failed to mark payment as paid: ${(error as Error).message}`);
    }
  }
}

// Export singleton instance
const paymentRepository = new PaymentRepository();
export default paymentRepository;
