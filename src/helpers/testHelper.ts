import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip98 } from "nostr-tools";
import { Account } from "../models/account";
import { Payment } from "../models/payment";
import { DEFAULT_SUBSCRIPTION } from "../models/accountSubscription";
import { now } from "./now";

export const generateNIP98 = async (method = 'GET') => {
  const keyPair = generateKeyPair()
  const token = await nip98.getToken('http://localhost:3000/api/account', method, e => finalizeEvent(e, keyPair.privateKey))
  return {
    ...keyPair,
    token,
  };
};

export const generateKeyPair = () => {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  return {
    privateKey: sk,
    pubkey,
    npub: nip19.npubEncode(pubkey),
  }
}

export const testAccount = (partial?: Partial<Account>): Account => ({
  id: generateKeyPair().pubkey,
  type: 'account',
  pubkey: generateKeyPair().npub,
  username: 'bla',
  tier: 'free',
  subscription: DEFAULT_SUBSCRIPTION,
  expires: Date.now() + 1000000,
  created: now(),
  modified: now(),
  ...partial,
});

export const testPayment = (partial?: Partial<Payment>): Payment => {
  const at = now();

  return {
    id: 'test-uuid-id',
    type: 'payment',
    paymentType: 'ln',
    lnHash: 'test-hash',
    lnInvoice: 'lnbc1234567890',
    lnAmountSat: 22200,
    tier: 'premium',
    billingCycle: 'monthly',
    priceCents: 999,
    pubkey: generateKeyPair().npub,
    isPaid: false,
    created: at,
    modified: at,
    expires: at + 5000,
    ...partial,
  }
};

// Helper function to create a mock iterator
export const createMockIterator = (values: any[]) => ({
  [Symbol.asyncIterator]: () => {
    let index = 0;
    return {
      next: () => Promise.resolve({
        value: values[index],
        done: index++ >= values.length
      })
    };
  }
});
