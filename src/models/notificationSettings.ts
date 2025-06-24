import { CosmosDbEntity } from "../database/CosmosDbBaseRepository";

export interface NotificationSettings extends CosmosDbEntity {
  id: string; // Will be "notificatoin-settings-" + pubkey
  type: 'notification-settings';
  pubkey: string; // Partition key
  enabled: boolean;
  filters?: any; // Custom filters for premium users
  settings?: any; // Additional settings
  created: number;
  modified: number;
}
