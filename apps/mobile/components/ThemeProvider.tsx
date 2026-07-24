import type { PropsWithChildren } from "react";
import { useEffect } from "react";

import { useThemeStore } from "../stores/theme-store";

export function ThemeProvider({ children }: PropsWithChildren) {
  const hydrate = useThemeStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return children;
}
