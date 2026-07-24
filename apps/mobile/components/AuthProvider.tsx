import type { PropsWithChildren } from "react";
import { useEffect } from "react";

import { useAuthStore } from "../stores/auth-store";

export function AuthProvider({ children }: PropsWithChildren) {
  const hydrate = useAuthStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return children;
}
