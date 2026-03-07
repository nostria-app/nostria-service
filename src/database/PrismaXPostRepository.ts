import { XPostMetric, XPostUsageSummary } from '../models/xPostMetric';
import { now } from '../helpers/now';
import { PrismaBaseRepository } from './PrismaBaseRepository';
import logger from '../utils/logger';

class PrismaXPostRepository extends PrismaBaseRepository {
  constructor() {
    super('x-post-metric');
  }

  private transformPrismaXPostMetric(prismaXPostMetric: {
    id: string;
    pubkey: string;
    xPostId: string;
    hasMedia: boolean;
    created: bigint;
    modified: bigint;
  }): XPostMetric {
    return {
      id: prismaXPostMetric.id,
      type: 'x-post-metric',
      pubkey: prismaXPostMetric.pubkey,
      xPostId: prismaXPostMetric.xPostId,
      hasMedia: prismaXPostMetric.hasMedia,
      created: Number(prismaXPostMetric.created),
      modified: Number(prismaXPostMetric.modified),
    };
  }

  async recordPost(pubkey: string, xPostId: string, hasMedia: boolean): Promise<XPostMetric> {
    try {
      const created = now();
      const record = await this.prisma.xPostMetric.create({
        data: {
          pubkey,
          xPostId,
          hasMedia,
          created: BigInt(created),
          modified: BigInt(created),
        },
      });

      return this.transformPrismaXPostMetric(record);
    } catch (error) {
      logger.error('Failed to record X post metric:', error);
      throw new Error(`Failed to record X post metric: ${(error as Error).message}`);
    }
  }

  async getUsageSummary(pubkey: string): Promise<XPostUsageSummary> {
    const summaries = await this.getUsageSummaries([pubkey]);
    return summaries[pubkey] || {
      pubkey,
      totalPosts: 0,
      postsLast24h: 0,
    };
  }

  async getUsageSummaries(pubkeys: string[]): Promise<Record<string, XPostUsageSummary>> {
    if (pubkeys.length === 0) {
      return {};
    }

    try {
      const since = now() - (24 * 60 * 60 * 1000);
      const [totalCounts, recentCounts, lastPosts] = await Promise.all([
        this.prisma.xPostMetric.groupBy({
          by: ['pubkey'],
          where: {
            pubkey: {
              in: pubkeys,
            },
          },
          _count: {
            _all: true,
          },
        }),
        this.prisma.xPostMetric.groupBy({
          by: ['pubkey'],
          where: {
            pubkey: {
              in: pubkeys,
            },
            created: {
              gte: BigInt(since),
            },
          },
          _count: {
            _all: true,
          },
        }),
        this.prisma.xPostMetric.groupBy({
          by: ['pubkey'],
          where: {
            pubkey: {
              in: pubkeys,
            },
          },
          _max: {
            created: true,
          },
        }),
      ]);

      const summaries = Object.fromEntries(
        pubkeys.map((pubkey) => [pubkey, {
          pubkey,
          totalPosts: 0,
          postsLast24h: 0,
        } satisfies XPostUsageSummary])
      ) as Record<string, XPostUsageSummary>;

      for (const totalCount of totalCounts) {
        summaries[totalCount.pubkey] = {
          ...summaries[totalCount.pubkey],
          totalPosts: totalCount._count._all,
        };
      }

      for (const recentCount of recentCounts) {
        summaries[recentCount.pubkey] = {
          ...summaries[recentCount.pubkey],
          postsLast24h: recentCount._count._all,
        };
      }

      for (const lastPost of lastPosts) {
        summaries[lastPost.pubkey] = {
          ...summaries[lastPost.pubkey],
          lastPosted: lastPost._max.created ? Number(lastPost._max.created) : undefined,
        };
      }

      return summaries;
    } catch (error) {
      logger.error('Failed to get X post usage summaries:', error);
      throw new Error(`Failed to get X post usage summaries: ${(error as Error).message}`);
    }
  }
}

export default PrismaXPostRepository;
