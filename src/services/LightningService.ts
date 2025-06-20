class LightningService {
  async getUsdBtcRate(): Promise<number> {
    const response = await fetch('https://pay.ariton.app/price');
    if (!response.ok) {
      throw new Error(`Failed to fetch BTC rate: ${response.statusText}`);
    }
    const data = await response.json() as { usd: number };
    if (!data.usd || typeof data.usd !== 'number') {
      throw new Error('Invalid exchange rate data received');
    }
    return data.usd;
  }

  async createInvoice(amountSat: number, invoiceId: string, description = 'NostriaPremium'): Promise<{ serialized: string, paymentHash: string, amountSat: number }> {
    const url = `https://pay.ariton.app/invoice?description=${encodeURIComponent(description)}&amount=${amountSat}&id=${invoiceId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to create Lightning invoice: ${response.statusText}`);
    }
    const data = await response.json() as { serialized: string, paymentHash: string, amountSat: number };
    if (!data.serialized || !data.paymentHash || !data.amountSat) {
      throw new Error('Invalid invoice data received');
    }
    return data;
  }

  async checkPaymentStatus(hash: string): Promise<boolean> {
    const url = `https://pay.ariton.app/paid?hash=${hash}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to check payment status: ${response.statusText}`);
    }
    const data = await response.json() as { paid: boolean };
    if (typeof data.paid !== 'boolean') {
      throw new Error('Invalid payment status data received');
    }
    return data.paid;
  }
}

const lightningService = new LightningService();
export default lightningService;
