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
}

// Export singleton instance
const paymentRepository = new PaymentRepository();
export default paymentRepository;
