import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const darkModeStorageKey = "yupresence.theme.dark";

interface ThemeState {
  isDark: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: false,
  isHydrated: false,
  hydrate: async () => {
    try {
      const storedValue = await SecureStore.getItemAsync(darkModeStorageKey);
      set({ isDark: storedValue === "true" });
    } catch (error) {
      console.warn("Unable to restore the theme preference.", error);
    } finally {
      set({ isHydrated: true });
    }
  },
  toggle: async () => {
    const isDark = !get().isDark;
    set({ isDark });
    try {
      await SecureStore.setItemAsync(darkModeStorageKey, String(isDark));
    } catch (error) {
      console.warn("Unable to save the theme preference.", error);
    }
  }
}));
