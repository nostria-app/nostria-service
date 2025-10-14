export interface NotificationLog {
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
