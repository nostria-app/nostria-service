import { CosmosDbEntity } from "../database/CosmosDbBaseRepository";

export interface NotificationLog extends CosmosDbEntity {
  id: string; // Unique identifier for each notification
  type: 'notification-log';
  pubkey: string; // Partition key
  title?: string;
  body?: string;
  content?: string;
  template?: string;
  created: number;
  modified: number;
}
