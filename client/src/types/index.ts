export interface User {
  id: number;
  email: string;
  name: string | null;
  role: 'customer' | 'admin' | 'driver';
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: any;
}
