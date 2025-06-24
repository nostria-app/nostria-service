import { CosmosDbEntity } from "../database/CosmosDbBaseRepository";

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

export interface NotificationSubscription extends CosmosDbEntity {
  id: string; // Will be a combination of pubkey and device key (p256dh)
  type: 'notification-subscription';
  pubkey: string; // Partition key
  subscription: PushSubscription;
  deviceKey: string; // p256dh key used as unique identifier
  created: number;
  modified: number;
}
