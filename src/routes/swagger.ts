import { Router } from 'express';
import { swaggerSpec } from '../config/swagger';

const router = Router();

// Serve the raw OpenAPI/Swagger JSON at two paths for convenience
router.get(['/openapi.json'], (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

export default router;
