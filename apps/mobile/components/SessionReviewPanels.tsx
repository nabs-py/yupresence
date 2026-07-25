import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../constants/theme";
import { getFlaggedAttempts, getPendingStudents, getPresentStudents, markPendingStudentPresent, markPresentStudentAbsent, reviewFlaggedAttempt } from "../lib/api";

type Panel = "present" | "flagged" | "pending";

export function SessionReviewPanels({ sessionId, token }: { sessionId: number; token: string }) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>("pending");
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingQuery = useQuery({
    queryKey: ["professor", "pending-students", sessionId],
    queryFn: () => getPendingStudents(token, sessionId),
    refetchInterval: 2_000
  });
  const flaggedQuery = useQuery({
    queryKey: ["professor", "flagged-attempts", sessionId],
    queryFn: () => getFlaggedAttempts(token, sessionId),
    refetchInterval: 2_000
  });
  const presentQuery = useQuery({
    queryKey: ["professor", "present-students", sessionId],
    queryFn: () => getPresentStudents(token, sessionId),
    refetchInterval: 2_000
  });

  async function markPresent(studentId: string) {
    setError(null);
    setActionId(`student-${studentId}`);
    try {
      await markPendingStudentPresent(token, sessionId, studentId);
      await pendingQuery.refetch();
      await presentQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "reports"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to mark this student present.");
    } finally {
      setActionId(null);
    }
  }

  async function markAbsent(studentId: string) {
    setError(null);
    setActionId(`present-${studentId}`);
    try {
      await markPresentStudentAbsent(token, sessionId, studentId);
      await presentQuery.refetch();
      await pendingQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "reports"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to mark this student absent.");
    } finally {
      setActionId(null);
    }
  }

  async function review(attemptId: number, decision: "accept" | "reject") {
    setError(null);
    setActionId(`attempt-${attemptId}`);
    try {
      await reviewFlaggedAttempt(token, attemptId, decision);
      await flaggedQuery.refetch();
      await pendingQuery.refetch();
      await presentQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["professor", "reports"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review this attempt.");
    } finally {
      setActionId(null);
    }
  }

  const pendingCount = pendingQuery.data?.students.length ?? 0;
  const flaggedCount = flaggedQuery.data?.attempts.length ?? 0;
  const presentCount = presentQuery.data?.students.length ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Attendance follow-up</Text>
        </View>
      </View>
      <View style={styles.switcher}>
        <Pressable hitSlop={4} onPress={() => setPanel("present")} style={[styles.switchButton, panel === "present" && styles.switchButtonActive]}>
          <Text style={[styles.switchLabel, panel === "present" && styles.switchLabelActive]}>Present · {presentCount}</Text>
        </Pressable>
        <Pressable hitSlop={4} onPress={() => setPanel("pending")} style={[styles.switchButton, panel === "pending" && styles.switchButtonActive]}>
          <Text style={[styles.switchLabel, panel === "pending" && styles.switchLabelActive]}>Pending · {pendingCount}</Text>
        </Pressable>
        <Pressable hitSlop={4} onPress={() => setPanel("flagged")} style={[styles.switchButton, panel === "flagged" && styles.switchButtonActive]}>
          <Text style={[styles.switchLabel, panel === "flagged" && styles.switchLabelActive]}>Flagged · {flaggedCount}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {panel === "present" ? (
        <View style={styles.body}>
          {presentQuery.isLoading ? <ActivityIndicator color={theme.colors.black} /> : null}
          {!presentQuery.isLoading && presentCount === 0 ? <Text style={styles.empty}>No students are marked present.</Text> : null}
          {presentQuery.data?.students.map((student) => (
            <View key={student.student_id} style={styles.row}>
              <View style={styles.identity}>
                <Text numberOfLines={2} style={styles.name}>{student.name}</Text>
                <Text style={styles.studentId}>Student ID: {student.student_id}</Text>
              </View>
              <Pressable disabled={actionId !== null} onPress={() => void markAbsent(student.student_id)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionLabel}>{actionId === `present-${student.student_id}` ? "Updating..." : "Mark Absent"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : panel === "pending" ? (
        <View style={styles.body}>
          {pendingQuery.isLoading ? <ActivityIndicator color={theme.colors.black} /> : null}
          {!pendingQuery.isLoading && pendingCount === 0 ? <Text style={styles.empty}>Everyone is accounted for.</Text> : null}
          {pendingQuery.data?.students.map((student) => (
            <View key={student.student_id} style={styles.row}>
              <View style={styles.identity}>
                <Text numberOfLines={2} style={styles.name}>{student.name}</Text>
                <Text style={styles.studentId}>Student ID: {student.student_id}</Text>
              </View>
              <Pressable disabled={actionId !== null} onPress={() => void markPresent(student.student_id)} style={styles.primaryAction}>
                <Text style={styles.primaryActionLabel}>{actionId === `student-${student.student_id}` ? "Marking..." : "Mark Present"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.body}>
          {flaggedQuery.isLoading ? <ActivityIndicator color={theme.colors.black} /> : null}
          {!flaggedQuery.isLoading && flaggedCount === 0 ? <Text style={styles.empty}>No flagged attempts to review.</Text> : null}
          {flaggedQuery.data?.attempts.map((attempt) => (
            <View key={attempt.attempt_id} style={styles.flaggedRow}>
              <View style={styles.identity}>
                <Text numberOfLines={2} style={styles.name}>{attempt.student_name}</Text>
                <Text style={styles.studentId}>Student ID: {attempt.student_id}</Text>
                <Text style={styles.confidence}>{attempt.confidence_score ?? 5}% confidence</Text>
                {attempt.failures.map((failure) => (
                  <Text key={failure.code} style={styles.reason}>{failure.heading}</Text>
                ))}
                <Text style={styles.attemptCount}>{attempt.attempt_count} {attempt.attempt_count === 1 ? "attempt" : "attempts"}</Text>
              </View>
              <View style={styles.actionColumn}>
                <Pressable disabled={actionId !== null} onPress={() => void review(attempt.attempt_id, "reject")} style={styles.secondaryAction}>
                  <Text style={styles.secondaryActionLabel}>Reject</Text>
                </Pressable>
                <Pressable disabled={actionId !== null} onPress={() => void review(attempt.attempt_id, "accept")} style={styles.primaryAction}>
                  <Text style={styles.primaryActionLabel}>{actionId === `attempt-${attempt.attempt_id}` ? "Working..." : "Accept"}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.card, borderWidth: 1, marginTop: theme.spacing.xxl, overflow: "hidden" },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl },
  title: { color: theme.colors.black, ...theme.typography.heading },
  switcher: { backgroundColor: theme.colors.grey100, borderRadius: theme.radius.button, flexDirection: "row", gap: theme.spacing.xs, margin: theme.spacing.lg, padding: theme.spacing.xs },
  switchButton: { alignItems: "center", borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 44, paddingVertical: theme.spacing.sm },
  switchButtonActive: { backgroundColor: theme.colors.orange },
  switchLabel: { color: theme.colors.grey700, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  switchLabelActive: { color: theme.colors.onAccent },
  body: { borderTopColor: theme.colors.grey200, borderTopWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.lg },
  row: { alignItems: "center", backgroundColor: theme.colors.white, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, flexDirection: "row", gap: theme.spacing.md, padding: theme.spacing.md },
  flaggedRow: { alignItems: "flex-start", backgroundColor: theme.colors.white, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, flexDirection: "row", gap: theme.spacing.md, padding: theme.spacing.md },
  identity: { flex: 1 },
  name: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  studentId: { color: theme.colors.grey600, marginTop: 2, ...theme.typography.label },
  reason: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  confidence: { color: theme.colors.orange, marginTop: theme.spacing.sm, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  attemptCount: { color: theme.colors.grey600, marginTop: 2, ...theme.typography.label },
  actionColumn: { flexBasis: "32%", flexGrow: 0, flexShrink: 1, gap: theme.spacing.xs, maxWidth: 132, minWidth: 96 },
  primaryAction: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.sm },
  primaryActionLabel: { color: theme.colors.onAccent, textAlign: "center", ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  secondaryAction: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.sm },
  secondaryActionLabel: { color: theme.colors.black, textAlign: "center", ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  empty: { color: theme.colors.grey600, paddingVertical: theme.spacing.md, textAlign: "center", ...theme.typography.body },
  error: { color: theme.colors.red, marginHorizontal: theme.spacing.lg, ...theme.typography.label }
});
