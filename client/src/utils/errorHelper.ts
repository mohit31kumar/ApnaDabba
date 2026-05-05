import { AxiosError } from 'axios';

// [FIX] ISSUE 5: Error Normalization Helper
export interface NormalizedError {
  message: string;
  code: string;
}

export const formatApiError = (error: unknown): NormalizedError => {
  if (error instanceof AxiosError) {
    const apiMessage = error.response?.data?.message;
    const apiCode = error.response?.data?.error;
    
    return {
      message: apiMessage || 'An unexpected server error occurred.',
      code: apiCode || error.code || 'UNKNOWN_API_ERROR',
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: 'CLIENT_ERROR',
    };
  }

  return {
    message: 'An unknown error occurred.',
    code: 'UNKNOWN_ERROR',
  };
};