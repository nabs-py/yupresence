import { Redirect, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../constants/theme";
import { routeForRole } from "../../lib/auth/routes";
import { useAuthStore } from "../../stores/auth-store";

export default function AuthLayout() {
  const theme = useAppTheme();
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const role = useAuthStore((state) => state.role);

  if (!isHydrated) {
    return null;
  }

  if (role) {
    return <Redirect href={routeForRole(role)} />;
  }

  return <SafeAreaView edges={["top", "bottom"]} style={{ backgroundColor: theme.colors.white, flex: 1 }}><Stack screenOptions={{ headerShown: false }} /></SafeAreaView>;
}
