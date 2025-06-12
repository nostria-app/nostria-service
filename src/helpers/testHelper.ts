import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip98 } from "nostr-tools";

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