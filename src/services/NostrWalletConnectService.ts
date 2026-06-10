import { SimplePool, Event, finalizeEvent, nip04, nip19 } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';

import config from '../config';

interface NwcConnection {
  walletPubkey: string;
  secretKey: Uint8Array;
  relays: string[];
}

export interface NwcPayInvoiceResult {
  preimage?: string;
  paymentHash?: string;
  feesPaid?: number;
  response: Record<string, unknown>;
}

interface NwcResponseContent {
  result_type?: string;
  error?: {
    code?: string;
    message?: string;
  };
  result?: Record<string, unknown>;
}

class NostrWalletConnectService {
  private readonly pool = new SimplePool();

  isConfigured(): boolean {
    return Boolean(config.nwc?.connectionString);
  }

  async payInvoice(invoice: string): Promise<NwcPayInvoiceResult> {
    const connection = this.parseConnectionString();
    const requestId = uuidv4();
    const content = JSON.stringify({
      method: 'pay_invoice',
      params: {
        invoice,
      },
      request_id: requestId,
    });

    const encryptedContent = await nip04.encrypt(connection.secretKey, connection.walletPubkey, content);
    const event = finalizeEvent({
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', connection.walletPubkey]],
      content: encryptedContent,
    }, connection.secretKey);

    const responsePromise = this.waitForResponse(connection, event.id);
    const publishResults = await Promise.allSettled(this.pool.publish(connection.relays, event));
    const published = publishResults.some(result => result.status === 'fulfilled');

    if (!published) {
      throw new Error('Unable to publish NWC payment request to configured relays');
    }

    const response = await responsePromise;
    const decrypted = await nip04.decrypt(connection.secretKey, connection.walletPubkey, response.content);
    const payload = JSON.parse(decrypted) as NwcResponseContent;

    if (payload.error) {
      const message = payload.error.message || payload.error.code || 'NWC wallet returned an error';
      throw new Error(message);
    }

    if (payload.result_type && payload.result_type !== 'pay_invoice') {
      throw new Error(`Unexpected NWC response type: ${payload.result_type}`);
    }

    const result = payload.result || {};

    return {
      preimage: typeof result['preimage'] === 'string' ? result['preimage'] : undefined,
      paymentHash: typeof result['payment_hash'] === 'string' ? result['payment_hash'] : undefined,
      feesPaid: typeof result['fees_paid'] === 'number' ? result['fees_paid'] : undefined,
      response: payload as Record<string, unknown>,
    };
  }

  close(): void {
    const connectionString = config.nwc?.connectionString;
    if (!connectionString) {
      return;
    }

    try {
      this.pool.close(this.parseConnectionString().relays);
    } catch {
      // Ignore shutdown cleanup errors.
    }
  }

  private waitForResponse(connection: NwcConnection, requestEventId: string): Promise<Event> {
    const timeoutMs = config.nwc?.timeoutMs || 30000;

    return new Promise<Event>((resolve, reject) => {
      let subscription: { close: () => void };
      const timeout = setTimeout(() => {
        subscription.close();
        reject(new Error('Timed out waiting for NWC payment response'));
      }, timeoutMs);

      subscription = this.pool.subscribeMany(
        connection.relays,
        [{
          kinds: [23195],
          authors: [connection.walletPubkey],
          '#e': [requestEventId],
        }],
        {
          onevent: (event: Event) => {
            clearTimeout(timeout);
            subscription.close();
            resolve(event);
          },
        },
      );
    });
  }

  private parseConnectionString(): NwcConnection {
    const connectionString = config.nwc?.connectionString;

    if (!connectionString) {
      throw new Error('Nostr Wallet Connect is not configured');
    }

    const url = new URL(connectionString);
    const walletPubkey = url.hostname || url.pathname.replace(/^\/+/, '');
    const secret = url.searchParams.get('secret');
    const relays = url.searchParams.getAll('relay');

    if (!walletPubkey || !secret || relays.length === 0) {
      throw new Error('Invalid Nostr Wallet Connect connection string');
    }

    return {
      walletPubkey,
      secretKey: this.parseSecretKey(secret),
      relays,
    };
  }

  private parseSecretKey(secret: string): Uint8Array {
    if (secret.startsWith('nsec')) {
      const decoded = nip19.decode(secret);
      if (!(decoded.data instanceof Uint8Array)) {
        throw new Error('Invalid NWC nsec secret');
      }
      return decoded.data;
    }

    if (!/^[a-fA-F0-9]{64}$/.test(secret)) {
      throw new Error('Invalid NWC hex secret');
    }

    return Uint8Array.from(secret.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  }
}

const nostrWalletConnectService = new NostrWalletConnectService();
export default nostrWalletConnectService;
