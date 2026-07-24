import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../../constants/theme";
import { getStudentCourses } from "../../lib/api";
import { formatGregorianDate } from "../../lib/date";
import { useAuthStore } from "../../stores/auth-store";

export default function StudentCoursesScreen() {
  const appTheme = useAppTheme();
  const styles = createStyles(appTheme);
  const token = useAuthStore((state) => state.token);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const coursesQuery = useQuery({
    queryKey: ["student", "courses"],
    queryFn: () => getStudentCourses(token as string),
    enabled: Boolean(token)
  });

  if (coursesQuery.isLoading) {
    return <View style={styles.centered}><ActivityIndicator color={appTheme.colors.black} /><Text style={styles.body}>Loading courses...</Text></View>;
  }

  if (coursesQuery.error || !coursesQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load courses</Text><Text style={styles.body}>Please try again.</Text><Pressable onPress={() => void coursesQuery.refetch()} style={styles.retry}><Text style={styles.retryLabel}>Retry</Text></Pressable></View>;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Courses</Text>
      {coursesQuery.data.courses.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyTitle}>No courses yet</Text><Text style={styles.body}>Your enrolled courses will appear here once they are added.</Text></View> : null}
      {coursesQuery.data.courses.map((course) => {
        const key = `${course.course_code}-${course.section}`;
        const isExpanded = expandedCourse === key;
        return (
          <View key={key} style={[styles.courseCard, course.warning_status === "warning" && styles.courseCardWarning, course.warning_status === "critical" && styles.courseCardCritical]}>
            <Pressable onPress={() => setExpandedCourse(isExpanded ? null : key)} style={styles.courseHeader}>
              <View style={styles.courseHeading}>
                <Text numberOfLines={1} style={styles.courseCode}>{course.course_code}</Text>
                <Text numberOfLines={2} style={styles.courseName}>{course.course_name} · Section {course.section}</Text>
              </View>
              <Text style={styles.chevron}>{isExpanded ? "−" : "+"}</Text>
            </Pressable>
            <View style={styles.statsRow}>
              <Text style={styles.attendance}>{course.attendance_percentage}%</Text>
              <Text numberOfLines={1} style={styles.counts}>{course.present_count} present · {course.absent_count} absent</Text>
            </View>
            {isExpanded ? (
              <View style={styles.history}>
                <Text style={styles.historyTitle}>Attendance history</Text>
                {course.history.map((entry) => (
                  <View key={`${entry.date}-${entry.status}`} style={styles.historyRow}>
                    <Text style={styles.historyDate}>{formatGregorianDate(entry.date)}</Text>
                    <Text style={[styles.historyStatus, entry.status === "present" ? styles.present : styles.absent]}>{entry.status}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  title: { color: theme.colors.black, ...theme.typography.display },
  body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body },
  retry: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.xl, minHeight: 48, paddingHorizontal: theme.spacing.xl },
  retryLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  emptyState: { alignItems: "center", backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xxl, padding: theme.spacing.xl },
  emptyTitle: { color: theme.colors.black, ...theme.typography.heading },
  courseCard: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xl, padding: theme.spacing.lg },
  courseCardWarning: { borderColor: theme.colors.yellow, borderWidth: 1 },
  courseCardCritical: { borderColor: theme.colors.red, borderWidth: 1 },
  courseHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 48 },
  courseHeading: { flex: 1 },
  courseCode: { color: theme.colors.black, ...theme.typography.heading },
  courseName: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  chevron: { color: theme.colors.black, paddingLeft: theme.spacing.md, ...theme.typography.body, fontFamily: theme.fontFamily.regular, fontSize: 28 },
  statsRow: { alignItems: "baseline", borderTopColor: theme.colors.grey200, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, justifyContent: "space-between", marginTop: theme.spacing.lg, paddingTop: theme.spacing.md },
  attendance: { color: theme.colors.black, ...theme.typography.heading },
  counts: { color: theme.colors.grey600, ...theme.typography.label },
  history: { borderTopColor: theme.colors.grey200, borderTopWidth: 1, marginTop: theme.spacing.lg, paddingTop: theme.spacing.md },
  historyTitle: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  historyRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: theme.spacing.sm },
  historyDate: { color: theme.colors.grey600, ...theme.typography.label },
  historyStatus: { textTransform: "capitalize", ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  present: { color: theme.colors.black },
  absent: { color: theme.colors.grey500 }
});
