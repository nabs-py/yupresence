import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SessionReviewPanels } from "../../../components/SessionReviewPanels";
import { AppTheme, useAppTheme } from "../../../constants/theme";
import { getProfessorSessionDetail } from "../../../lib/api";
import { formatGregorianDateTime } from "../../../lib/date";
import { useAuthStore } from "../../../stores/auth-store";
import { RetryButton } from "../../../components/RetryButton";

export default function ProfessorSessionDetailScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const sessionQuery = useQuery({
    queryKey: ["professor", "session", sessionId],
    queryFn: () => getProfessorSessionDetail(token as string, sessionId),
    enabled: Boolean(token && Number.isInteger(sessionId) && sessionId > 0)
  });

  if (sessionQuery.isLoading || (sessionQuery.isFetching && !sessionQuery.data)) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.black} /><Text style={styles.body}>Loading session...</Text></View>;
  }
  if (sessionQuery.error || !sessionQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Session unavailable</Text><RetryButton onPress={() => void sessionQuery.refetch()} /><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backLabel}>Back to Reports</Text></Pressable></View>;
  }

  const { session } = sessionQuery.data;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable hitSlop={6} onPress={() => router.back()} style={styles.backControl}><Text style={styles.backText}>‹ Reports</Text></Pressable>
      <Text style={styles.title}>{session.course_code}</Text>
      <Text style={styles.section}>Section {session.section}</Text>
      <Text style={styles.courseName}>{session.course_name}</Text>
      <Text style={styles.date}>{session.created_at ? formatGregorianDateTime(session.created_at) : "Session date unavailable"}</Text>

      <View style={styles.counterRow}>
        <Counter label="Present" value={session.present_count} theme={theme} />
        <Counter label="Pending" value={session.pending_count} theme={theme} />
        <Counter label="Flagged" value={session.flagged_count} theme={theme} />
      </View>
      <SessionReviewPanels sessionId={session.session_id} token={token as string} />
    </ScrollView>
  );
}

function Counter({ label, value, theme }: { label: string; value: number; theme: AppTheme }) {
  return <View style={stylesForCounter.counter}><Text style={{ color: theme.colors.black, ...theme.typography.heading }}>{value}</Text><Text style={{ color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label }}>{label}</Text></View>;
}

const stylesForCounter = StyleSheet.create({ counter: { alignItems: "center", flex: 1 } });

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  backControl: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44 },
  backText: { color: theme.colors.grey600, ...theme.typography.body },
  backButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 48, paddingHorizontal: theme.spacing.lg },
  backLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  eyebrow: { color: theme.colors.grey600, marginTop: theme.spacing.xxl, ...theme.typography.label },
  title: { color: theme.colors.black, marginTop: theme.spacing.xs, ...theme.typography.display },
  section: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.heading },
  courseName: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.body },
  date: { color: theme.colors.grey500, marginTop: theme.spacing.md, ...theme.typography.label },
  counterRow: { borderBottomColor: theme.colors.grey200, borderBottomWidth: 1, borderTopColor: theme.colors.grey200, borderTopWidth: 1, flexDirection: "row", marginTop: theme.spacing.xxl, paddingVertical: theme.spacing.lg },
  body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body }
});
