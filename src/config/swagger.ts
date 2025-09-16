import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

// Build glob patterns that work both in development (TS source) and production (compiled JS in dist)
const routesGlobJs = path.join(__dirname, '..', 'routes', '*.js');
const routesGlobTs = path.join(process.cwd(), 'src', 'routes', '*.ts');

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Nostria Backend API',
      version: '1.0.0',
      description: 'API documentation for Nostria Backend Service',
    },
    servers: [
      {
        url: process.env.API_URL || '/api/',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        NIP98Auth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'NIP-98 authentication token',
        },
      },
    },
  },
  // Try compiled JS routes first (used in production), then TS sources (used in dev)
  apis: [routesGlobJs, routesGlobTs],
};

export const swaggerSpec = swaggerJsdoc(options); 