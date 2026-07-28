import { ProfileSettingsScreen } from "../../components/ProfileSettingsScreen";
import { changeStudentPassword, getStudentProfile, submitDeviceChangeRequest } from "../../lib/api";

export default function StudentProfileScreen() {
  return <ProfileSettingsScreen queryKey={["student", "profile"]} loadProfile={async (token) => {
    const profile = await getStudentProfile(token);
    return { name: profile.name, email: profile.email, identifier: profile.student_id, identifierLabel: "University ID", secondaryDetail: profile.department ? `Department: ${profile.department}` : null, deviceChangeRequest: profile.device_change_request ? { status: profile.device_change_request.status, grantedAt: profile.device_change_request.granted_at } : null };
  }} submitDeviceChange={submitDeviceChangeRequest} updatePassword={changeStudentPassword} />;
}
