import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../../constants/theme";
import { routeForRole } from "../../lib/auth/routes";
import { useAuthStore } from "../../stores/auth-store";

export default function ProfessorTabsLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const role = useAuthStore((state) => state.role);

  if (!isHydrated) {
    return null;
  }

  if (role !== "professor") {
    return <Redirect href={role ? routeForRole(role) : "/(auth)/sign-in"} />;
  }

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.colors.white, flex: 1 }}><Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.orange,
        tabBarInactiveTintColor: theme.colors.grey500,
        tabBarShowLabel: false,
        tabBarItemStyle: { minHeight: 48 },
        tabBarIconStyle: { height: 28, width: 28 },
          tabBarStyle: {
            backgroundColor: theme.colors.white,
            borderTopColor: theme.colors.grey200,
            height: 64 + insets.bottom,
            paddingBottom: theme.spacing.sm + insets.bottom,
            paddingTop: theme.spacing.sm
        }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarAccessibilityLabel: "Home", tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? "home" : "home-outline"} size={size} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Reports", tabBarAccessibilityLabel: "Reports", tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? "bar-chart" : "bar-chart-outline"} size={size} /> }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="session/[sessionId]" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarAccessibilityLabel: "Profile", tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? "person" : "person-outline"} size={size} /> }} />
    </Tabs></SafeAreaView>
  );
}
