import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../../constants/theme";
import { getStudentAttendance, getStudentProfile } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";

export default function StudentHomeScreen() {
  const appTheme = useAppTheme();
  const styles = createStyles(appTheme);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["student", "profile"],
    queryFn: () => getStudentProfile(token as string),
    enabled: Boolean(token)
  });
  const attendanceQuery = useQuery({
    queryKey: ["student", "attendance"],
    queryFn: () => getStudentAttendance(token as string),
    enabled: Boolean(token)
  });

  useFocusEffect(useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["student", "profile"] }),
      queryClient.invalidateQueries({ queryKey: ["student", "attendance"] })
    ]);
  }, [queryClient]));

  if (profileQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator color={appTheme.colors.black} size="large" />
        <Text style={styles.stateLabel}>Loading your attendance...</Text>
      </View>
    );
  }

  const error = profileQuery.error ?? attendanceQuery.error;
  if (error || !profileQuery.data || !attendanceQuery.data) {
    return (
      <View style={styles.centeredState}>
        <Text style={styles.stateTitle}>Unable to load attendance</Text>
        <Text style={styles.stateLabel}>{error instanceof Error ? error.message : "Please try again."}</Text>
        <Pressable onPress={() => { void profileQuery.refetch(); void attendanceQuery.refetch(); }} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { data: profile } = profileQuery;
  const { data: attendance } = attendanceQuery;

  if (attendance.courses.length === 0) {
    return <View style={styles.centeredState}><Text style={styles.stateTitle}>No courses yet</Text><Text style={styles.stateLabel}>Your enrolled courses will appear here once they are added.</Text></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <Text numberOfLines={2} style={styles.greeting}>Good to see you, {profile.name.split(" ")[0]}</Text>
      <Text style={styles.pageTitle}>Attendance</Text>

      <View style={styles.primaryCard}>
        <Text style={styles.cardEyebrow}>Overall presence</Text>
        <Text style={styles.percentage}>{attendance.overall_percentage}%</Text>
        <View style={styles.courseList}>
          {attendance.courses.map((course) => {
            const needsAttention = course.warning_status === "warning" || course.warning_status === "critical";

            return (
              <View key={`${course.course_id}-${course.section}`} style={[styles.courseRow, course.warning_status === "warning" && styles.courseRowWarning, course.warning_status === "critical" && styles.courseRowCritical]}>
                <Text numberOfLines={1} style={styles.courseCode}>{course.course_code}</Text>
                <View style={styles.courseMeta}>
                  <Text numberOfLines={1} style={[styles.absenceCount, course.warning_status === "warning" && styles.warningText, course.warning_status === "critical" && styles.criticalText]}>
                    {course.absence_count} {course.absence_count === 1 ? "absence" : "absences"}
                  </Text>
                  {needsAttention ? <Text style={styles.warningTier}>{course.warning_status}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.metricRow}>
          <View>
            <Text style={styles.metricValue}>{attendance.attendance_streak}</Text>
            <Text style={styles.metricLabel}>Session streak</Text>
          </View>
          <View style={styles.metricDivider} />
          <View>
            <Text style={styles.metricValue}>{attendance.present_today ? "Yes" : "No"}</Text>
            <Text style={styles.metricLabel}>Present today</Text>
          </View>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, attendance.present_today ? styles.statusDotPresent : styles.statusDotPending]} />
        <Text style={styles.statusText}>{attendance.present_today ? "Present today" : "Not marked today"}</Text>
      </View>

      <Pressable onPress={() => router.push("/(student)/scan")} style={styles.scanButton}>
        <Text style={styles.scanButtonLabel}>Scan Attendance</Text>
      </Pressable>

      {attendance.warnings.length > 0 ? (
        <View style={styles.warningSection}>
          <Text style={styles.sectionTitle}>Active warnings</Text>
          {attendance.warnings.map((warning) => (
            <View key={warning.id} style={styles.warningCard}>
              <Text numberOfLines={2} style={styles.warningTitle}>{warning.course_code} · Section {attendance.courses.find((course) => course.course_id === warning.course_id)?.section ?? ""}</Text>
              <Text style={styles.warningDescription}>
                {warning.absence_count} absences, {warning.attendance_percentage}% attendance ({warning.status}).
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  greeting: { color: theme.colors.grey600, ...theme.typography.body },
  pageTitle: { color: theme.colors.black, marginTop: theme.spacing.xs, ...theme.typography.display },
  primaryCard: {
    backgroundColor: theme.colors.grey50,
    borderRadius: theme.radius.card,
    marginTop: theme.spacing.xxl,
    padding: theme.spacing.xl
  },
  cardEyebrow: { color: theme.colors.grey600, ...theme.typography.label },
  percentage: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.hugeStat },
  courseList: { borderTopColor: theme.colors.grey200, borderTopWidth: 1, marginTop: theme.spacing.xl, paddingTop: theme.spacing.sm },
  courseRow: { alignItems: "center", borderBottomColor: theme.colors.grey200, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 44, paddingVertical: theme.spacing.sm },
  courseRowWarning: { backgroundColor: theme.colors.orangeSoft, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm },
  courseRowCritical: { backgroundColor: theme.colors.orangeSoft, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm },
  courseCode: { color: theme.colors.black, flexShrink: 1, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  courseMeta: { alignItems: "flex-end", flexShrink: 1, marginLeft: theme.spacing.sm },
  absenceCount: { color: theme.colors.grey700, ...theme.typography.label },
  warningText: { color: theme.colors.yellow, fontFamily: theme.fontFamily.semibold },
  criticalText: { color: theme.colors.red, fontFamily: theme.fontFamily.semibold },
  warningTier: { color: theme.colors.orange, marginTop: 2, textTransform: "capitalize", ...theme.typography.label },
  metricRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing.xl, marginTop: theme.spacing.xxl },
  metricDivider: { alignSelf: "stretch", backgroundColor: theme.colors.grey300, width: StyleSheet.hairlineWidth },
  metricValue: { color: theme.colors.black, ...theme.typography.heading },
  metricLabel: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  statusRow: { alignItems: "center", flexDirection: "row", marginTop: theme.spacing.xl },
  statusDot: { borderRadius: theme.radius.button, height: 10, marginRight: theme.spacing.sm, width: 10 },
  statusDotPresent: { backgroundColor: theme.colors.orange },
  statusDotPending: { backgroundColor: theme.colors.grey400 },
  statusText: { color: theme.colors.grey700, ...theme.typography.body },
  scanButton: {
    alignItems: "center",
    backgroundColor: theme.colors.orange,
    borderRadius: theme.radius.button,
    justifyContent: "center",
    marginTop: theme.spacing.xxl,
    minHeight: 58,
    paddingHorizontal: theme.spacing.xl
  },
  scanButtonLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  warningSection: { marginTop: theme.spacing.xxxl },
  sectionTitle: { color: theme.colors.black, ...theme.typography.heading },
  warningCard: {
    backgroundColor: theme.colors.grey100,
    borderRadius: theme.radius.card,
    marginTop: theme.spacing.md,
    padding: theme.spacing.lg
  },
  warningTitle: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  warningDescription: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  centeredState: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  stateTitle: { color: theme.colors.black, textAlign: "center", ...theme.typography.heading },
  stateLabel: { color: theme.colors.grey600, marginTop: theme.spacing.md, textAlign: "center", ...theme.typography.body },
  retryButton: { backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, marginTop: theme.spacing.xl, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  retryLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }
});
