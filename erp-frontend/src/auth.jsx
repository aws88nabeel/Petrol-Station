import React, { createContext, useContext, useState } from 'react';
import { api, getUser, setAuth, clearAuth, getToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getUser());

  const login = async (username, password) => {
    const data = await api.login(username, password);
    setAuth(data.token, data.user);
    setUser(data.user);
    return data.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    await api.changePassword({ currentPassword, newPassword });
    const next = { ...(getUser() || { user_id: user?.user_id }), must_change_password: false };
    setAuth(getToken(), next);
    setUser(next);
  };

  const logout = () => {
    clearAuth();
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, login, changePassword, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}