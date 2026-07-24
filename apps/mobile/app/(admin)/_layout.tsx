import { Redirect, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../constants/theme";
import { routeForRole } from "../../lib/auth/routes";
import { useAuthStore } from "../../stores/auth-store";

export default function AdminStackLayout() {
  const theme = useAppTheme();
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const role = useAuthStore((state) => state.role);

  if (!isHydrated) {
    return null;
  }

  if (role !== "admin") {
    return <Redirect href={role ? routeForRole(role) : "/(auth)/sign-in"} />;
  }

  return <SafeAreaView edges={["top", "bottom"]} style={{ backgroundColor: theme.colors.white, flex: 1 }}><Stack screenOptions={{ headerShown: false }} /></SafeAreaView>;
}
