import React, { createContext, useContext, useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { AuthResponse, TenantData, UserData } from "@/types/onboarding";

interface AuthContextType {
  user: UserData | null;
  tenant: TenantData | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (auth: AuthResponse) => void;
  logout: () => void;
  refreshSession: () => Promise<void>;
  setTenant: React.Dispatch<React.SetStateAction<TenantData | null>>;
  setUser: React.Dispatch<React.SetStateAction<UserData | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [token, setToken] = useState<string | null>(() => apiClient.getToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshSession = async () => {
    let currentToken = apiClient.getToken();

    // If no access token in localStorage, attempt silent refresh from HttpOnly cookie
    if (!currentToken) {
      currentToken = await apiClient.refreshToken();
    }

    if (!currentToken) {
      setUser(null);
      setTenant(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const auth = await apiClient.get<AuthResponse>("/api/v1/auth/me");
      setUser(auth.user);
      setTenant(auth.tenant);
      setToken(currentToken);
    } catch (err) {
      console.warn("Session validation failed, attempting cookie refresh:", err);
      const refreshed = await apiClient.refreshToken();
      if (refreshed) {
        try {
          const auth = await apiClient.get<AuthResponse>("/api/v1/auth/me");
          setUser(auth.user);
          setTenant(auth.tenant);
          setToken(refreshed);
          setIsLoading(false);
          return;
        } catch {
          // Fall through
        }
      }
      apiClient.removeToken();
      setUser(null);
      setTenant(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  const login = (auth: AuthResponse) => {
    apiClient.setToken(auth.access_token);
    setToken(auth.access_token);
    setUser(auth.user);
    setTenant(auth.tenant);
  };

  const logout = () => {
    apiClient.logout();
    setToken(null);
    setUser(null);
    setTenant(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        logout,
        refreshSession,
        setTenant,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
