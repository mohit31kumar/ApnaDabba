import { Request } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user: {
      id: string;
      role: string;
      [key: string]: any;
    };
    resource?: any; // Holds the fetched DB entity to prevent duplicate queries in controllers
  }
}