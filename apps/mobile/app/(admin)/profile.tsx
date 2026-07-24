import { ProfileSettingsScreen } from "../../components/ProfileSettingsScreen";
import { changeAdminPassword, getAdminProfile } from "../../lib/api";

export default function AdminProfileScreen() {
  return <ProfileSettingsScreen
    backLabel="Admin"
    queryKey={["admin", "profile"]}
    loadProfile={async (token) => {
      const profile = await getAdminProfile(token);
      return { name: profile.name, email: profile.email, identifier: profile.admin_code, identifierLabel: "Admin code" };
    }}
    updatePassword={changeAdminPassword}
  />;
}
