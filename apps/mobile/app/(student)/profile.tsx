import { ProfileSettingsScreen } from "../../components/ProfileSettingsScreen";
import { changeStudentPassword, getStudentProfile } from "../../lib/api";

export default function StudentProfileScreen() {
  return <ProfileSettingsScreen queryKey={["student", "profile"]} loadProfile={async (token) => {
    const profile = await getStudentProfile(token);
    return { name: profile.name, email: profile.email, identifier: profile.student_id, identifierLabel: "University ID", secondaryDetail: profile.department ? `Department: ${profile.department}` : null };
  }} updatePassword={changeStudentPassword} />;
}
