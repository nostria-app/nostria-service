import NostrZapService from './NostrZapService';

describe('NostrZapService', () => {
  let service: NostrZapService;

  beforeEach(() => {
    service = new NostrZapService();
  });

  afterEach(() => {
    service.stop();
  });

  describe('parseZapContent', () => {
    it('should parse valid zap content', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
1
Enjoy!`;

      const result = (service as any).parseZapContent(content);

      expect(result).toEqual({
        recipientPubkey: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
        subscriptionType: 'premium',
        months: 1,
        message: 'Enjoy!'
      });
    });

    it('should parse premium_plus subscription', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium-plus
3
Happy holidays!`;

      const result = (service as any).parseZapContent(content);

      expect(result).toEqual({
        recipientPubkey: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
        subscriptionType: 'premium-plus',
        months: 3,
        message: 'Happy holidays!'
      });
    });

    it('should reject invalid pubkey format', () => {
      const content = `🎁 Nostria Premium Gift
invalid_pubkey
premium
1
Enjoy!`;

      const result = (service as any).parseZapContent(content);

      expect(result).toBeNull();
    });

    it('should reject invalid subscription type', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
invalid_type
1
Enjoy!`;

      const result = (service as any).parseZapContent(content);

      expect(result).toBeNull();
    });

    it('should reject invalid months value', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
15
Enjoy!`;

      const result = (service as any).parseZapContent(content);

      expect(result).toBeNull();
    });

    it('should handle content without message', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
1`;

      const result = (service as any).parseZapContent(content);

      expect(result).toEqual({
        recipientPubkey: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
        subscriptionType: 'premium',
        months: 1,
        message: undefined
      });
    });

    it('should handle multi-line messages', () => {
      const content = `🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
1
Line 1
Line 2
Line 3`;

      const result = (service as any).parseZapContent(content);

      expect(result?.message).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('validatePaymentAmount', () => {
    it('should validate correct premium monthly payment with real BTC price', async () => {
      // Mock the lightning service
      const mockBtcRate = 100000; // $100,000 per BTC
      (service as any).btcUsdRate = mockBtcRate;
      
      // 1 month premium = $10 = 1000 cents
      // 1 BTC = $100,000 = 10,000,000 cents
      // 1 BTC = 100,000,000 sats
      // So 1 sat = 10,000,000 / 100,000,000 cents = 0.1 cents
      // 1000 cents / 0.1 = 10,000 sats
      const result = await (service as any).validatePaymentAmount('premium', 1, 10000);
      expect(result).toBe(true);
    });

    it('should validate correct premium_plus monthly payment with real BTC price', async () => {
      const mockBtcRate = 100000;
      (service as any).btcUsdRate = mockBtcRate;
      
      // 1 month premium_plus = $25 = 2500 cents = 25,000 sats
      const result = await (service as any).validatePaymentAmount('premium-plus', 1, 25000);
      expect(result).toBe(true);
    });

    it('should validate multiple months', async () => {
      const mockBtcRate = 100000;
      (service as any).btcUsdRate = mockBtcRate;
      
      // 3 months premium = $30 = 3000 cents = 30,000 sats
      const result = await (service as any).validatePaymentAmount('premium', 3, 30000);
      expect(result).toBe(true);
    });

    it('should accept payment within 10% tolerance', async () => {
      const mockBtcRate = 100000;
      (service as any).btcUsdRate = mockBtcRate;
      
      // 1 month premium = $10 = 10,000 sats
      // 90% of 10,000 = 9,000 sats (minimum acceptable)
      const result = await (service as any).validatePaymentAmount('premium', 1, 9500);
      expect(result).toBe(true);
    });

    it('should reject payment below tolerance', async () => {
      const mockBtcRate = 100000;
      (service as any).btcUsdRate = mockBtcRate;
      
      // 1 month premium = $10 = 10,000 sats
      // Below 90% tolerance
      const result = await (service as any).validatePaymentAmount('premium', 1, 8000);
      expect(result).toBe(false);
    });

    it('should adjust for different BTC prices', async () => {
      const mockBtcRate = 50000; // $50,000 per BTC (half price)
      (service as any).btcUsdRate = mockBtcRate;
      
      // 1 month premium = $10 = 1000 cents
      // At $50k/BTC: 1 sat = 0.05 cents
      // 1000 cents / 0.05 = 20,000 sats
      const result = await (service as any).validatePaymentAmount('premium', 1, 20000);
      expect(result).toBe(true);
    });
  });
});
