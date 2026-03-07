export interface XPostMetric {
  id: string;
  type: 'x-post-metric' | string;
  pubkey: string;
  xPostId: string;
  hasMedia: boolean;
  created: number;
  modified: number;
}

export interface XPostUsageSummary {
  pubkey: string;
  totalPosts: number;
  postsLast24h: number;
  lastPosted?: number;
}
