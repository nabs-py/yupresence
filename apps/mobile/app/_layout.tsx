import "../global.css";

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../components/AuthProvider";
import { QueryProvider } from "../components/QueryProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { useAppTheme, theme } from "../constants/theme";
import { useAuthStore } from "../stores/auth-store";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [theme.fontFamily.regular]: Inter_400Regular,
    [theme.fontFamily.medium]: Inter_500Medium,
    [theme.fontFamily.semibold]: Inter_600SemiBold,
    [theme.fontFamily.bold]: Inter_700Bold
  });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <QueryProvider>
            <RootNavigator fontError={fontError} fontsLoaded={fontsLoaded} />
          </QueryProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

interface RootNavigatorProps {
  fontError: Error | null;
  fontsLoaded: boolean;
}

function RootNavigator({ fontError, fontsLoaded }: RootNavigatorProps) {
  const appTheme = useAppTheme();
  const isHydrated = useAuthStore((state) => state.isHydrated);

  useEffect(() => {
    if ((fontsLoaded || fontError) && isHydrated) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded, isHydrated]);

  if ((!fontsLoaded && !fontError) || !isHydrated) {
    return null;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar backgroundColor={appTheme.colors.white} style={appTheme === theme ? "dark" : "light"} />
    </>
  );
}
