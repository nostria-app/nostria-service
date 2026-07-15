import { getStoreProduct, resolvePriceCents } from './storeProductCatalog';

describe('storeProductCatalog', () => {
  it('resolves primary App Store premium monthly product', () => {
    const product = getStoreProduct('nostria_premium_monthly');
    expect(product).toBeDefined();
    expect(product?.tier).toBe('premium');
    expect(product?.billingCycle).toBe('monthly');
    expect(resolvePriceCents(product!)).toBe(999);
  });

  it('returns undefined for unknown product ids', () => {
    expect(getStoreProduct('not_a_real_sku')).toBeUndefined();
  });

  it('maps username one-time product to premium yearly', () => {
    const product = getStoreProduct('username');
    expect(product?.kind).toBe('one_time');
    expect(product?.tier).toBe('premium');
    expect(product?.billingCycle).toBe('yearly');
  });
});
