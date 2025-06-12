import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip98 } from "nostr-tools";
import { Account } from "../services/AccountService";

export const generateNIP98 = async (method = 'GET') => {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const token = await nip98.getToken('http://localhost:3000/api/account', method, e => finalizeEvent(e, sk))
  return {
    privateKey: sk,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    token,
  };
};

export const testAccount = (partial?: { pubkey?: string, email?: string, username?: string }): Account => ({
  pubkey: 'npub1test123456789',
  email: 'test@email.com',
  username: 'bla',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...partial,
});

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
