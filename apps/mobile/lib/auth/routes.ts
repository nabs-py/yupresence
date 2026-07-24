import type { Href } from "expo-router";

import type { AuthRole } from "./token";

export function routeForRole(role: AuthRole): Href {
  switch (role) {
    case "student":
      return "/(student)" as Href;
    case "professor":
      return "/(professor)" as Href;
    case "admin":
      return "/(admin)" as Href;
  }
}
