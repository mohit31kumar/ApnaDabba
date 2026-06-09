import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'ADMIN' | 'CUSTOMER' | 'DELIVERY_BOY';

export interface User {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
}

interface AuthState {
  user: User | null;
  role: Role | null;
  activeSubscriptionId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  _hydrated: boolean;
  
  setAuth: (user: User, role: Role, accessToken: string, refreshToken: string, activeSubscriptionId?: string | null) => void;
  updateTokens: (accessToken: string, refreshToken: string) => void;
  setActiveSubscriptionId: (id: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: null,
      activeSubscriptionId: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hydrated: false,

      setAuth: (user, role, accessToken, refreshToken, activeSubscriptionId = null) => 
        set({ user, role, accessToken, refreshToken, activeSubscriptionId, isAuthenticated: true, _hydrated: true }),
        
      updateTokens: (accessToken, refreshToken) => 
        set({ accessToken, refreshToken }),

      setActiveSubscriptionId: (activeSubscriptionId) => 
        set({ activeSubscriptionId }),

      logout: () => 
        set({ user: null, role: null, activeSubscriptionId: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hydrated: true });
      },
    }
  )
);