import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: any;
}

export const sendResponse = <T>(
  res: Response,
  statusCode: number,
  message: string,
  data?: T,
  error?: any
): Response => {
  const response: ApiResponse<T> = {
    success: statusCode < 400,
    statusCode,
    message,
    ...(data && { data }),
    ...(error && { error }),
  };

  return res.status(statusCode).json(response);
};

export const sendSuccess = <T>(
  res: Response,
  statusCode: number,
  message: string,
  data?: T
): Response => {
  return sendResponse(res, statusCode, message, data);
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  error?: any
): Response => {
  return sendResponse(res, statusCode, message, undefined, error);
};
