import { bech32 } from '@scure/base';

export const isValidNpub = (npub: string): boolean => {
    try {
        const { prefix } = bech32.decode(npub);
        return prefix === 'npub';
    } catch (_err) {
        return false;
    }
};

export const isPotentiallyPubkey = (pubkey: string): boolean => {
    if (typeof pubkey !== 'string' || pubkey.length !== 64) {
        return false;
    }

    return true;
};