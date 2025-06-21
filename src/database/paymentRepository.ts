
import { Payment } from "../models/payment";
import BaseRepository from "./BaseRepository";

class PaymentService extends BaseRepository<Payment> {
  constructor() {
    super("payments");
  }

  async create(payment: Payment): Promise<Payment> {
    await this.tableClient.createEntity({
      partitionKey: 'payment',
      rowKey: payment.id,
      ...payment,
    });

    return payment;
  }

  async update(payment: Payment): Promise<Payment> {
    await this.tableClient.updateEntity({
      partitionKey: 'payment',
      rowKey: payment.id,
      ...payment,
    }, 'Replace');

    return payment;
  }

  async get(id: string): Promise<Payment | null> {
    return this.getEntity('payment', id);
  }
}

export default new PaymentService(); 