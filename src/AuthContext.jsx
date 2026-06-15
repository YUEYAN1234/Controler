import React, { createContext, useContext, useState, useEffect } from 'react';
import { getStoredUser, setStoredUser, clearStoredUser, setToken as setApiToken, clearToken as clearApiToken, getMe } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (localStorage.getItem('token')) {
          const userData = await getMe();
          setUser(userData);
          setStoredUser(userData);
        }
      } catch (err) {
        console.error('Failed to restore auth', err);
        logout();
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const login = (token, userData) => {
    setApiToken(token);
    setStoredUser(userData);
    setUser(userData);
  };

  const logout = () => {
    clearApiToken();
    clearStoredUser();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="full-center-loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
