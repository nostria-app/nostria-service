import { bech32 } from '@scure/base';

export const isValidNpub = (npub: string): boolean => {
  try {
    bech32.decode(npub);
    return true;
  } catch (_err) {
    return false;
  }
};