import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppTheme } from "../../constants/theme";
import { getStudentCourses, submitStudentAppeal } from "../../lib/api";
import { formatGregorianDate } from "../../lib/date";
import { useAuthStore } from "../../stores/auth-store";

interface AppealDraft {
  sessionId: number;
  courseCode: string;
  section: string;
  date: string;
}

interface AttachmentDraft {
  uri: string;
  name: string;
  mimeType: string;
}

function isAppealWindowOpen(date: string): boolean {
  const sessionTime = new Date(date).getTime();
  return Number.isFinite(sessionTime) && Date.now() - sessionTime <= 7 * 24 * 60 * 60 * 1000;
}

export default function StudentCoursesScreen() {
  const appTheme = useAppTheme();
  const styles = createStyles(appTheme);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [appealDraft, setAppealDraft] = useState<AppealDraft | null>(null);
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<AttachmentDraft | null>(null);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const coursesQuery = useQuery({
    queryKey: ["student", "courses"],
    queryFn: () => getStudentCourses(token as string),
    enabled: Boolean(token)
  });

  useFocusEffect(useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["student", "courses"] });
  }, [queryClient]));

  function openAppeal(draft: AppealDraft) {
    setAppealDraft(draft);
    setMessage("");
    setAttachment(null);
    setAppealError(null);
  }

  function closeAppeal() {
    if (!submitting) setAppealDraft(null);
  }

  async function pickAttachment() {
    Keyboard.dismiss();
    setAppealError(null);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ["application/pdf", "image/*"]
    });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    const mimeType = file.mimeType ?? (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    setAttachment({ uri: file.uri, name: file.name, mimeType });
    Keyboard.dismiss();
  }

  async function submitAppeal() {
    if (!appealDraft || !message.trim()) {
      setAppealError("Explain why you believe you should be marked present.");
      return;
    }
    setSubmitting(true);
    setAppealError(null);
    try {
      await submitStudentAppeal(token as string, {
        sessionId: appealDraft.sessionId,
        message: message.trim(),
        attachment: attachment ?? undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["student", "courses"] });
      await queryClient.invalidateQueries({ queryKey: ["student", "attendance"] });
      setAppealDraft(null);
    } catch (error) {
      setAppealError(error instanceof Error ? error.message : "Unable to submit your appeal.");
    } finally {
      setSubmitting(false);
    }
  }

  if (coursesQuery.isLoading) {
    return <View style={styles.centered}><ActivityIndicator color={appTheme.colors.black} /><Text style={styles.body}>Loading courses...</Text></View>;
  }

  if (coursesQuery.error || !coursesQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load courses</Text><Text style={styles.body}>Please try again.</Text><Pressable onPress={() => void coursesQuery.refetch()} style={styles.retry}><Text style={styles.retryLabel}>Retry</Text></Pressable></View>;
  }

  return (
    <>
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
                    <View key={entry.session_id} style={styles.historyRow}>
                      <View style={styles.historyInfo}>
                        <Text style={styles.historyDate}>{formatGregorianDate(entry.date)}</Text>
                        <Text style={[styles.historyStatus, entry.status === "present" ? styles.present : styles.absent]}>{entry.status}</Text>
                      </View>
                      {entry.status === "absent" && !entry.appeal && isAppealWindowOpen(entry.date) ? <Pressable onPress={() => openAppeal({ sessionId: entry.session_id, courseCode: course.course_code, section: course.section, date: entry.date })} style={styles.appealButton}><Text style={styles.appealButtonLabel}>Appeal</Text></Pressable> : null}
                      {entry.status === "absent" && !entry.appeal && !isAppealWindowOpen(entry.date) ? <Text style={styles.appealClosed}>Appeal window closed</Text> : null}
                      {entry.appeal ? <Text style={styles.appealStatus}>Appeal {entry.appeal.status}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <AppealModal
        attachment={attachment}
        draft={appealDraft}
        error={appealError}
        message={message}
        onAttachment={pickAttachment}
        onClose={closeAppeal}
        onMessage={setMessage}
        onRemoveAttachment={() => setAttachment(null)}
        onSubmit={() => void submitAppeal()}
        submitting={submitting}
        theme={appTheme}
      />
    </>
  );
}

function AppealModal({ attachment, draft, error, message, onAttachment, onClose, onMessage, onRemoveAttachment, onSubmit, submitting, theme }: {
  attachment: AttachmentDraft | null;
  draft: AppealDraft | null;
  error: string | null;
  message: string;
  onAttachment: () => void;
  onClose: () => void;
  onMessage: (value: string) => void;
  onRemoveAttachment: () => void;
  onSubmit: () => void;
  submitting: boolean;
  theme: ReturnType<typeof useAppTheme>;
}) {
  const styles = createStyles(theme);
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(draft)}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboardFrame}>
        <Pressable onPress={Keyboard.dismiss} style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Appeal absence</Text>
            {draft ? <Text style={styles.modalMeta}>{draft.courseCode} · Section {draft.section} · {formatGregorianDate(draft.date)}</Text> : null}
            <TextInput multiline onChangeText={onMessage} placeholder="Explain what happened" placeholderTextColor={theme.colors.grey500} style={styles.messageInput} textAlignVertical="top" value={message} />
            {attachment ? <View style={styles.attachmentRow}><Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text><Pressable onPress={onRemoveAttachment} style={styles.removeAttachment}><Text style={styles.removeAttachmentLabel}>Remove</Text></Pressable></View> : <Pressable onPress={onAttachment} style={styles.attachmentButton}><Text style={styles.attachmentButtonLabel}>Add image or PDF</Text></Pressable>}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable disabled={submitting} onPress={onClose} style={styles.cancelButton}><Text style={styles.cancelLabel}>Cancel</Text></Pressable>
              <Pressable disabled={submitting} onPress={onSubmit} style={styles.submitButton}>{submitting ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.submitLabel}>Submit appeal</Text>}</Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  </Modal>;
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 }, content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge }, centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl }, title: { color: theme.colors.black, ...theme.typography.display }, body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body }, retry: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.xl, minHeight: 48, paddingHorizontal: theme.spacing.xl }, retryLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }, emptyState: { alignItems: "center", backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xxl, padding: theme.spacing.xl }, emptyTitle: { color: theme.colors.black, ...theme.typography.heading }, courseCard: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xl, padding: theme.spacing.lg }, courseCardWarning: { borderColor: theme.colors.yellow, borderWidth: 1 }, courseCardCritical: { borderColor: theme.colors.red, borderWidth: 1 }, courseHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 48 }, courseHeading: { flex: 1 }, courseCode: { color: theme.colors.black, ...theme.typography.heading }, courseName: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label }, chevron: { color: theme.colors.black, paddingLeft: theme.spacing.md, ...theme.typography.body, fontFamily: theme.fontFamily.regular, fontSize: 28 }, statsRow: { alignItems: "baseline", borderTopColor: theme.colors.grey200, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, justifyContent: "space-between", marginTop: theme.spacing.lg, paddingTop: theme.spacing.md }, attendance: { color: theme.colors.black, ...theme.typography.heading }, counts: { color: theme.colors.grey600, ...theme.typography.label }, history: { borderTopColor: theme.colors.grey200, borderTopWidth: 1, marginTop: theme.spacing.lg, paddingTop: theme.spacing.md }, historyTitle: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, historyRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing.sm, justifyContent: "space-between", paddingVertical: theme.spacing.sm }, historyInfo: { flex: 1 }, historyDate: { color: theme.colors.grey600, ...theme.typography.label }, historyStatus: { marginTop: 2, textTransform: "capitalize", ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, present: { color: theme.colors.black }, absent: { color: theme.colors.grey500 }, appealButton: { alignItems: "center", borderColor: theme.colors.orange, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.md }, appealButtonLabel: { color: theme.colors.orange, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, appealClosed: { color: theme.colors.grey600, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, appealStatus: { color: theme.colors.grey600, textTransform: "capitalize", ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)", flex: 1, justifyContent: "center", padding: theme.spacing.lg }, modalCard: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, maxWidth: 520, padding: theme.spacing.xl, width: "100%" }, modalTitle: { color: theme.colors.black, ...theme.typography.heading }, modalMeta: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label }, messageInput: { backgroundColor: theme.colors.white, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, color: theme.colors.black, marginTop: theme.spacing.lg, minHeight: 120, padding: theme.spacing.md, ...theme.typography.body }, attachmentButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", marginTop: theme.spacing.md, minHeight: 44, paddingHorizontal: theme.spacing.md }, attachmentButtonLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, attachmentRow: { alignItems: "center", backgroundColor: theme.colors.grey100, borderRadius: theme.radius.control, flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md, minHeight: 44, paddingHorizontal: theme.spacing.md }, attachmentName: { color: theme.colors.black, flex: 1, ...theme.typography.label }, removeAttachment: { minHeight: 44, justifyContent: "center" }, removeAttachmentLabel: { color: theme.colors.orange, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, error: { color: theme.colors.red, marginTop: theme.spacing.sm, ...theme.typography.label }, modalActions: { flexDirection: "row", gap: theme.spacing.sm, justifyContent: "flex-end", marginTop: theme.spacing.xl }, cancelButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: theme.spacing.lg }, cancelLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, submitButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", minHeight: 48, minWidth: 132, paddingHorizontal: theme.spacing.lg }, submitLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }
  , keyboardFrame: { maxHeight: "100%", width: "100%" }, modalScrollContent: { paddingBottom: theme.spacing.sm }
});
