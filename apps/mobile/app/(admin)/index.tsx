import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../../constants/theme";
import { getAdminStatistics } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";
import { RetryButton } from "../../components/RetryButton";

export default function AdminHomeScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const stats = useQuery({ queryKey: ["admin", "statistics"], queryFn: () => getAdminStatistics(token as string), enabled: Boolean(token) });
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.title}>Admin</Text>
    {stats.isLoading || (stats.isFetching && !stats.data) ? <ActivityIndicator color={theme.colors.black} style={styles.loading} /> : null}
    {stats.error && !stats.isFetching ? <View style={styles.statsError}><Text style={styles.error}>Unable to load statistics.</Text><RetryButton onPress={() => void stats.refetch()} /></View> : null}
    {stats.data ? <View style={styles.statGrid}>
      <Stat label="Students" value={stats.data.students} theme={theme} />
      <Stat label="Professors" value={stats.data.professors} theme={theme} />
      <Stat label="Courses" value={stats.data.courses} theme={theme} />
      <Stat label="Sections" value={stats.data.sections} theme={theme} />
      <Stat label="Sessions run" value={stats.data.sessions} theme={theme} />
    </View> : null}
    <Text style={styles.section}>Management</Text>
    <NavButton label="Course management" onPress={() => router.push("/(admin)/courses")} styles={styles} />
    <NavButton label="Professor management" onPress={() => router.push("/(admin)/professors")} styles={styles} />
    <NavButton label="Student management" onPress={() => router.push("/(admin)/students")} styles={styles} />
    <NavButton label="Student Appeals" onPress={() => router.push("/(admin)/appeals")} styles={styles} />
    <NavButton label="Profile & settings" onPress={() => router.push("/(admin)/profile")} styles={styles} />
  </ScrollView>;
}

function Stat({ label, theme, value }: { label: string; theme: ReturnType<typeof useAppTheme>; value: number }) {
  return <View style={{ backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, minWidth: "47%", padding: theme.spacing.md }}><Text style={{ color: theme.colors.black, ...theme.typography.heading }}>{value}</Text><Text style={{ color: theme.colors.grey600, ...theme.typography.label }}>{label}</Text></View>;
}
function NavButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable onPress={onPress} style={styles.nav}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.navTitle}>{label}</Text></View><Text style={styles.navArrow}>›</Text></Pressable>;
}
const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 }, content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge }, title: { color: theme.colors.black, ...theme.typography.display }, loading: { marginTop: theme.spacing.xxl }, statsError: { alignItems: "flex-start", marginTop: theme.spacing.xl }, error: { color: theme.colors.red, ...theme.typography.body }, statGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.xxl }, section: { color: theme.colors.black, marginTop: theme.spacing.xxl, ...theme.typography.heading }, nav: { alignItems: "center", backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.card, borderWidth: 1, flexDirection: "row", marginTop: theme.spacing.md, minHeight: 64, padding: theme.spacing.lg }, navTitle: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }, navArrow: { color: theme.colors.black, fontSize: 28 }
});
