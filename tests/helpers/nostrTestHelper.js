const { generateKeyPair } = require('nostr-tools');
const { getPublicKey, nip19 } = require('nostr-tools');

// Mock Nostr authentication for testing
class NostrTestHelper {
  static generateTestKeypair() {
    const privateKey = generateKeyPair().privateKey;
    const publicKey = getPublicKey(privateKey);
    const npub = nip19.npubEncode(publicKey);
    
    return {
      privateKey,
      publicKey,
      npub
    };
  }

  static createMockNIP98Event(publicKey, privateKey, url, method = 'GET', payload = null) {
    const event = {
      kind: 27235,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', url],
        ['method', method]
      ],
      content: payload ? JSON.stringify(payload) : ''
    };

    // In a real implementation, you would sign this event with the private key
    // For testing purposes, we'll just return the unsigned event
    return event;
  }

  static createAuthHeader(event) {
    // In a real implementation, this would be a properly signed event
    return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
  }
}

module.exports = NostrTestHelper;
