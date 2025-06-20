process.env.AZURE_STORAGE_ACCOUNT = "test"
jest.mock('@azure/data-tables')
import paymentService, { PaymentInvoice } from './PaymentService';
import { createMockIterator } from '../helpers/testHelper';
import { BillingCycle, Tier } from '../config/types';


describe('PaymentService', () => {
  let mockTableClient: { upsertEntity: jest.Mock; getEntity: jest.Mock; listEntities: jest.Mock };

  const mockInvoice: PaymentInvoice = {
    id: 'test-id',
    hash: 'test-hash',
    invoice: 'lnbc1234567890',
    amountSat: 1000,
    tier: 'premium' as Tier,
    billingCycle: 'monthly' as BillingCycle,
    priceCents: 999,
    pubkey: 'npub1234567890',
    username: 'testuser',
    isPaid: false,
    expiresAt: new Date(Date.now() + 5000),
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockTableClient = (paymentService as any).tableClient;
  });

  describe('createInvoice', () => {
    it('should create a payment invoice', async () => {
      mockTableClient.upsertEntity.mockResolvedValue(undefined);

      const result = await paymentService.createInvoice({
        id: mockInvoice.id,
        hash: mockInvoice.hash,
        invoice: mockInvoice.invoice,
        amountSat: mockInvoice.amountSat,
        tier: mockInvoice.tier,
        billingCycle: mockInvoice.billingCycle,
        priceCents: mockInvoice.priceCents,
        pubkey: mockInvoice.pubkey,
        username: mockInvoice.username,
      });

      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith({
        partitionKey: 'payment',
        rowKey: mockInvoice.id,
        ...mockInvoice,
        isPaid: false,
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }, 'Replace');

      expect(result).toEqual({
        ...mockInvoice,
        isPaid: false,
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
    });
  });

  describe('getInvoiceByHash', () => {
    it('should return invoice by hash', async () => {
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([
        {
          partitionKey: 'payment',
          rowKey: mockInvoice.id,
          ...mockInvoice,
        },
      ]));

      const result = await paymentService.getInvoiceByHash('test-hash');

      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: "hash eq 'test-hash'" }
      });
      expect(result).toEqual(mockInvoice);
    });

    it('should return null when invoice not found', async () => {
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await paymentService.getInvoiceByHash('non-existent-hash');

      expect(result).toBeNull();
    });
  });

  describe('markInvoiceAsPaid', () => {
    it('should mark invoice as paid', async () => {
      mockTableClient.getEntity.mockResolvedValue({
        partitionKey: 'payment',
        rowKey: mockInvoice.id,
        ...mockInvoice,
      });
      mockTableClient.upsertEntity.mockResolvedValue(undefined);

      const result = await paymentService.markInvoiceAsPaid('test-id');

      expect(mockTableClient.getEntity).toHaveBeenCalledWith('payment', 'test-id');
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith({
        partitionKey: 'payment',
        rowKey: 'test-id',
        ...mockInvoice,
        isPaid: true,
        paidAt: expect.any(Date),
      }, 'Replace');

      expect(result).toEqual({
        ...mockInvoice,
        isPaid: true,
        paidAt: expect.any(Date),
      });
    });

    it('should throw error when invoice not found', async () => {
      mockTableClient.getEntity.mockRejectedValueOnce({
        statusCode: 404,
      });

      await expect(paymentService.markInvoiceAsPaid('non-existent-id'))
        .rejects.toThrow('Invoice not found');
    });
  });

  describe('getInvoice', () => {
    it('should return invoice by id', async () => {
      mockTableClient.getEntity.mockResolvedValue({
        partitionKey: 'payment',
        rowKey: mockInvoice.id,
        ...mockInvoice,
      });

      const result = await paymentService.getInvoice('test-id');

      expect(mockTableClient.getEntity).toHaveBeenCalledWith('payment', 'test-id');
      expect(result).toEqual(mockInvoice);
    });

    it('should return null when invoice not found', async () => {
      mockTableClient.getEntity.mockRejectedValueOnce({
        statusCode: 404,
      });

      const result = await paymentService.getInvoice('non-existent-id');

      expect(result).toBeNull();
    });
  });
}); 