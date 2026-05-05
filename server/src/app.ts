import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes/index';
import { errorMiddleware } from './middlewares/error.middleware';
import { logger } from './utils/logger';

const app: Express = express();

// Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req: Request, res: Response, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1', routes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: 'Route not found',
  });
});

// Error handler (must be last)
app.use(errorMiddleware);

export default app;
