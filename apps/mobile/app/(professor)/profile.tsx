import { ProfileSettingsScreen } from "../../components/ProfileSettingsScreen";
import { changeProfessorPassword, getProfessorProfile } from "../../lib/api";

export default function ProfessorProfileScreen() {
  return <ProfileSettingsScreen
    queryKey={["professor", "profile"]}
    loadProfile={async (token) => {
      const profile = await getProfessorProfile(token);
      return {
        name: profile.name,
        email: profile.email,
        identifier: profile.employee_id,
        identifierLabel: "Employee ID",
        secondaryDetail: profile.department ? `Department: ${profile.department}` : null
      };
    }}
    updatePassword={changeProfessorPassword}
  />;
}
