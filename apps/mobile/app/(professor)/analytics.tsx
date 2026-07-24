import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../../constants/theme";
import { getProfessorAnalytics } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";
import { RetryButton } from "../../components/RetryButton";

export default function ProfessorAnalyticsScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const analyticsQuery = useQuery({
    queryKey: ["professor", "analytics"],
    queryFn: () => getProfessorAnalytics(token as string),
    enabled: Boolean(token)
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.reportNav}>
        <Pressable onPress={() => router.replace("/(professor)/reports")} style={styles.reportNavButton}>
          <Text style={styles.reportNavLabel}>Past Sessions</Text>
        </Pressable>
        <Pressable style={[styles.reportNavButton, styles.reportNavButtonActive]}>
          <Text style={styles.reportNavLabelActive}>Analytics</Text>
        </Pressable>
      </View>

      {analyticsQuery.isLoading || (analyticsQuery.isFetching && !analyticsQuery.data) ? <ActivityIndicator color={theme.colors.black} style={styles.loading} /> : null}
      {analyticsQuery.error && !analyticsQuery.isFetching ? <View style={styles.messageState}><Text style={styles.error}>Unable to load analytics. Please try again.</Text><RetryButton onPress={() => void analyticsQuery.refetch()} /></View> : null}
      {!analyticsQuery.isLoading && !analyticsQuery.error && analyticsQuery.data?.sections.length === 0 ? <View style={styles.messageState}><Text style={styles.emptyTitle}>No analytics yet</Text><Text style={styles.empty}>Your teaching sections will appear here once they are assigned.</Text></View> : null}
      {analyticsQuery.data?.sections.map((section) => (
        <View key={`${section.course_id}-${section.section}`} style={styles.card}>
          <Text style={styles.sectionCode}>{section.course_code} · Section {section.section}</Text>
          <Text style={styles.courseName}>{section.course_name}</Text>
          <View style={styles.rateRow}>
            <Text style={styles.rate}>{section.attendance_rate}%</Text>
            <Text style={styles.rateCaption}>overall attendance</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="Sessions" value={section.total_sessions} theme={theme} />
            <Metric label="Students" value={section.enrolled_students} theme={theme} />
          </View>
          <Text style={styles.tierHeading}>Current tiers</Text>
          <View style={styles.tiers}>
            <Tier label="Excellent" value={section.tiers.excellent} theme={theme} />
            <Tier label="Safe" value={section.tiers.safe} theme={theme} />
            <Tier label="Warning" value={section.tiers.warning} theme={theme} />
            <Tier label="Critical" value={section.tiers.critical} theme={theme} strong />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Metric({ label, value, theme }: { label: string; value: number; theme: AppTheme }) {
  return <View style={{ flex: 1 }}><Text style={{ color: theme.colors.black, ...theme.typography.heading }}>{value}</Text><Text style={{ color: theme.colors.grey500, ...theme.typography.label }}>{label}</Text></View>;
}

function Tier({ label, strong = false, value, theme }: { label: string; strong?: boolean; value: number; theme: AppTheme }) {
  return <View style={{ backgroundColor: strong ? theme.colors.orange : theme.colors.grey100, borderRadius: theme.radius.control, minWidth: "47%", padding: theme.spacing.md }}><Text style={{ color: strong ? theme.colors.onAccent : theme.colors.black, ...theme.typography.heading }}>{value}</Text><Text style={{ color: strong ? theme.colors.onAccent : theme.colors.grey600, ...theme.typography.label }}>{label}</Text></View>;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  reportNav: { backgroundColor: theme.colors.grey100, borderRadius: theme.radius.button, flexDirection: "row", gap: theme.spacing.xs, padding: theme.spacing.xs },
  reportNavButton: { alignItems: "center", borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: theme.spacing.md },
  reportNavButtonActive: { backgroundColor: theme.colors.orange },
  reportNavLabel: { color: theme.colors.grey700, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  reportNavLabelActive: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  loading: { marginTop: theme.spacing.xxxl },
  error: { color: theme.colors.red, marginTop: theme.spacing.xxl, ...theme.typography.body },
  messageState: { alignItems: "center", marginTop: theme.spacing.xxxl },
  emptyTitle: { color: theme.colors.black, ...theme.typography.heading },
  empty: { color: theme.colors.grey600, marginTop: theme.spacing.sm, textAlign: "center", ...theme.typography.body },
  card: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.card, borderWidth: 1, marginTop: theme.spacing.xxl, padding: theme.spacing.xl },
  sectionCode: { color: theme.colors.black, ...theme.typography.heading },
  courseName: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  rateRow: { alignItems: "baseline", flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.xl },
  rate: { color: theme.colors.black, ...theme.typography.hugeStat },
  rateCaption: { color: theme.colors.grey500, flex: 1, ...theme.typography.label },
  metrics: { borderTopColor: theme.colors.grey200, borderTopWidth: 1, flexDirection: "row", marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg },
  tierHeading: { color: theme.colors.black, marginTop: theme.spacing.xl, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  tiers: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm }
});
