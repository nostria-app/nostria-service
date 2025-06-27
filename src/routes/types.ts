import { ParamsDictionary, Query } from 'express-serve-static-core';
import { Request } from 'express';

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     NIP98Auth:
 *       type: http
 *       scheme: bearer
 *       description: NIP-98 authentication using Nostr events
 */
export interface NIP98AuthenticatedRequest<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = Query,
  LocalsObj extends Record<string, any> = Record<string, any>
> extends Request<P, ResBody, ReqBody, ReqQuery, LocalsObj> {
  authenticatedPubkey?: string;
};


/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *         message:
 *           type: string
 *           description: Additional error details
 *           nullable: true
 */
export interface ErrorBody {
  error: string;
  message?: string;
}

// Settings API types
export interface UserSettingsCreateRequest {
  releaseChannel?: 'stable' | 'beta' | 'alpha';
  socialSharing?: boolean;
}

export interface UserSettingsUpdateRequest {
  releaseChannel?: 'stable' | 'beta' | 'alpha';
  socialSharing?: boolean;
}

export interface UserSettingsResponse {
  pubkey: string;
  releaseChannel: 'stable' | 'beta' | 'alpha';
  socialSharing: boolean;
  created: number;
  updated: number;
}

export interface UserSettingsApiResponse {
  success: boolean;
  message: string;
  data: UserSettingsResponse;
  isDefault?: boolean;
}

export interface ReleaseChannelUsersResponse {
  success: boolean;
  message: string;
  data: {
    releaseChannel: string;
    userCount: number;
    users: string[];
  };
}