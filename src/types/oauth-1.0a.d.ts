declare module 'oauth-1.0a' {
  type OAuthRequestData = {
    url: string;
    method: string;
    data?: Record<string, string>;
  };

  type OAuthToken = {
    key: string;
    secret: string;
  };

  type OAuthConsumer = {
    key: string;
    secret: string;
  };

  type OAuthOptions = {
    consumer: OAuthConsumer;
    signature_method: string;
    hash_function(baseString: string, key: string): string;
  };

  export default class OAuth {
    constructor(options: OAuthOptions);
    authorize(request: OAuthRequestData, token?: OAuthToken): Record<string, string>;
    toHeader(parameters: Record<string, string>): Record<string, string>;
  }
}