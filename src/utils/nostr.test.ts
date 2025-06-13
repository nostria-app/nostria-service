import { isValidNpub } from './nostr';

describe('isValidNpub', () => {
  test('should return true for valid npub format', () => {
    const validNpub = 'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9';
    expect(isValidNpub(validNpub)).toBe(true);
  });

  test('should return false for invalid npub format', () => {
    const invalidNpubs = [
      'invalid-npub',
      'npub1invalid',
      'npub1',
      'npub',
      '',
      'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9invalid',
      'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9!',
      'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9 ',
      ' npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9',
    ];

    invalidNpubs.forEach(npub => {
      expect(isValidNpub(npub)).toBe(false);
    });
  });

  test('should handle non-string inputs', () => {
    // @ts-ignore - Testing invalid input types
    expect(isValidNpub(null)).toBe(false);
    // @ts-ignore - Testing invalid input types
    expect(isValidNpub(undefined)).toBe(false);
    // @ts-ignore - Testing invalid input types
    expect(isValidNpub(123)).toBe(false);
    // @ts-ignore - Testing invalid input types
    expect(isValidNpub({})).toBe(false);
  });
});
