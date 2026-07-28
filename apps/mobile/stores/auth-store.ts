import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import { decodeAuthSession, type AuthRole, type AuthSession } from "../lib/auth/token";

export const authTokenStorageKey = "yupresence.auth.token";

async function ensureSecureStoreAvailable(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error("Secure storage is unavailable in this Expo Go runtime. Update Expo Go, then restart Metro with --clear.");
  }
}

interface AuthState {
  token: string | null;
  role: AuthRole | null;
  logoutMessage: string | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setSession: (token: string) => Promise<AuthSession>;
  signOut: (message?: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  logoutMessage: null,
  isHydrated: false,
  hydrate: async () => {
    try {
      await ensureSecureStoreAvailable();
      const storedToken = await SecureStore.getItemAsync(authTokenStorageKey);
      const session = storedToken ? decodeAuthSession(storedToken) : null;

      if (session) {
        set({ token: session.token, role: session.role });
      } else if (storedToken) {
        await SecureStore.deleteItemAsync(authTokenStorageKey);
      }
    } catch (error) {
      console.warn("Unable to restore the secure session.", error);
    } finally {
      set({ isHydrated: true });
    }
  },
  setSession: async (token) => {
    const session = decodeAuthSession(token);

    if (!session) {
      throw new Error("The server returned an invalid or expired session.");
    }

    await ensureSecureStoreAvailable();
    await SecureStore.setItemAsync(authTokenStorageKey, token);
    set({ token: session.token, role: session.role, logoutMessage: null });

    return session;
  },
  signOut: async (message) => {
    // Clear in-memory auth first. Local logout must not depend on storage or
    // network success, otherwise an invalid server token can trap the user.
    set({ token: null, role: null, logoutMessage: message ?? null });
    try {
      await SecureStore.deleteItemAsync(authTokenStorageKey);
    } catch (error) {
      // The app is already signed out in memory. Storage failure must never
      // block the route back to sign-in.
      console.warn("Unable to remove the stored secure session.", error);
    }
  }
}));
