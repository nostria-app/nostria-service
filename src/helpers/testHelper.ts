import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip98 } from "nostr-tools";
import { Account, DEFAULT_SUBSCRIPTION } from "../services/AccountService";

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

export const testAccount = (partial?: { pubkey?: string, email?: string, username?: string }): Account => ({
  pubkey: generateKeyPair().npub,
  email: 'test@email.com',
  username: 'bla',
  subscription: DEFAULT_SUBSCRIPTION,
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
