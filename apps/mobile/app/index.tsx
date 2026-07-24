import { Redirect, type Href } from "expo-router";

import { routeForRole } from "../lib/auth/routes";
import { useAuthStore } from "../stores/auth-store";

export default function IndexScreen() {
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const role = useAuthStore((state) => state.role);

  if (!isHydrated) {
    return null;
  }

  if (role) {
    return <Redirect href={routeForRole(role)} />;
  }

  return <Redirect href={"/(auth)/sign-in" as Href} />;
}
