import swaggerJsdoc from 'swagger-jsdoc';

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
  apis: ['./src/routes/*.ts'], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options); 