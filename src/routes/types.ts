import { ParamsDictionary, Query } from 'express-serve-static-core';
import { Request } from 'express';

export interface NIP98AuthenticatedRequest<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = Query,
  LocalsObj extends Record<string, any> = Record<string, any>
> extends Request<P, ResBody, ReqBody, ReqQuery, LocalsObj> {
  authenticatedPubkey?: string;
};

export interface ErrorBody {
  error: string
}