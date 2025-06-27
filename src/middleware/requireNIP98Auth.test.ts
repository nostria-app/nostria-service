// Mock removed - BaseRepository no longer exists
import { Request, Response, NextFunction } from 'express';
import requireNIP98Auth from './requireNIP98Auth';
import { generateNIP98 } from '../helpers/testHelper';
import { NIP98AuthenticatedRequest } from '../routes/types';

describe('NIP98 Authentication Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000'),
      method: 'GET',
      originalUrl: '/api/account'
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    nextFunction = jest.fn();
  });

  test('should return 401 if no authorization header', async () => {
    await requireNIP98Auth(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'NIP98 Authorization header required'
    });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  test('should return 401 if token validation fails', async () => {
    mockRequest.headers = {
      authorization: 'Nostr invalid-token'
    };

    await requireNIP98Auth(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: expect.stringContaining('Authorization validation failed')
    });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  test('should authenticate successfully with valid token', async () => {
    const auth = await generateNIP98()
    
    mockRequest.headers = {
      authorization: `Nostr ${auth.token}`
    };

    await requireNIP98Auth(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect((mockRequest as NIP98AuthenticatedRequest).authenticatedPubkey).toBe(auth.pubkey);
    expect(nextFunction).toHaveBeenCalled();
  });
});


