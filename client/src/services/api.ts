import axios, { InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

// [FIX] ISSUE 3: Axios Typing
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// [FIX] ISSUE 1: Safe Zustand Access Helper
const getAuthState = () => useAuthStore.getState();

export const api = axios.create({
  // [FIX] ISSUE 6: Strict Base URL
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: unknown) => void; reject: (reason?: any) => void }> = [];

// [FIX] ISSUE 2: Dedicated refresh client to prevent interceptor loops
const refreshClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.request.use(
  (config) => {
    const token = getAuthState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = getAuthState().refreshToken;
        if (!refreshToken) throw new Error('No refresh token available');

        const { data } = await refreshClient.post(`${api.defaults.baseURL}/api/v1/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const newAccessToken = data.data.tokens.access_token;
        const newRefreshToken = data.data.tokens.refresh_token;

        getAuthState().updateTokens(newAccessToken, newRefreshToken);
        api.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
        
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }

        processQueue(null, newAccessToken);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        getAuthState().logout();
        
        // [FIX] ISSUE 2: Safe Redirect (Since we are outside a React component)
        if (typeof window !== 'undefined') {
           window.dispatchEvent(new Event('auth:unauthorized'));
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);