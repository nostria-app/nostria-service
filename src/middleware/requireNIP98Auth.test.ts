import { Request, Response, NextFunction } from 'express';
import requireNIP98Auth from './requireNIP98Auth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip98 } from 'nostr-tools'

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
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const token = await nip98.getToken('http://localhost:3000/api/account', 'get', e => finalizeEvent(e, sk))
    
    mockRequest.headers = {
      authorization: `Nostr ${token}`
    };

    await requireNIP98Auth(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(mockRequest.authenticatedPubkey).toBe(pubkey);
    expect(nextFunction).toHaveBeenCalled();
  });

  test('should handle server errors gracefully', async () => {
    mockRequest.headers = {
      authorization: 'Nostr valid-token'
    };
    mockRequest.get = jest.fn().mockImplementation(() => {
      throw new Error('Test error');
    });

    await requireNIP98Auth(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Authentication service error'
    });
    expect(nextFunction).not.toHaveBeenCalled();
  });
});


