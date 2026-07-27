import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../constants/theme";
import { getAppealViewLink, type AppealResponse, resolveAppeal } from "../lib/api";
import { formatGregorianDateTime } from "../lib/date";

export function AppealReviewList({ appeals, emptyLabel, onResolved, token }: {
  appeals: AppealResponse[];
  emptyLabel: string;
  onResolved: () => Promise<unknown> | void;
  token: string;
}) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);

  async function resolve(appealId: number, decision: "accept" | "reject") {
    setBusyId(appealId);
    setError(null);
    try {
      await resolveAppeal(token, appealId, decision);
      await onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resolve this appeal.");
    } finally {
      setBusyId(null);
    }
  }

  async function openAttachment(appealId: number) {
    setBusyId(appealId);
    setError(null);
    try {
      const attachment = await getAppealViewLink(token, appealId);
      if (attachment.mime_type.startsWith("image/")) {
        setImagePreviewUri(attachment.url);
      } else if (attachment.mime_type === "application/pdf") {
        await WebBrowser.openBrowserAsync(attachment.url);
      } else {
        throw new Error("This attachment format cannot be previewed.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open this attachment.");
    } finally {
      setBusyId(null);
    }
  }

  if (appeals.length === 0) return <Text style={styles.empty}>{emptyLabel}</Text>;

  return <View style={styles.list}>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {appeals.map((appeal) => {
      const pending = appeal.status === "pending";
      const resolver = appeal.resolved_by_name
        ? `Resolved by ${appeal.resolved_by_role === "admin" ? "Admin" : "Professor"} ${appeal.resolved_by_name} — ${appeal.status}`
        : `Appeal ${appeal.status}`;
      return <View key={appeal.appeal_id} style={styles.card}>
        <View style={styles.headingRow}>
          <View style={styles.identity}>
            <Text numberOfLines={1} style={styles.studentName}>{appeal.student_name}</Text>
            <Text numberOfLines={1} style={styles.studentId}>Student ID: {appeal.student_id}</Text>
          </View>
          <View style={[styles.statusBadge, pending ? styles.pendingBadge : appeal.status === "accepted" ? styles.acceptedBadge : styles.rejectedBadge]}>
            <Text style={styles.statusLabel}>{appeal.status}</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={styles.course}>{appeal.course_code} · Section {appeal.section}</Text>
        <Text style={styles.date}>{appeal.session_date ? formatGregorianDateTime(appeal.session_date) : "Session date unavailable"}</Text>
        <Text style={styles.message}>{appeal.message}</Text>
        {appeal.has_attachment ? <Pressable disabled={busyId !== null} onPress={() => void openAttachment(appeal.appeal_id)} style={styles.attachmentButton}>{busyId === appeal.appeal_id ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.attachmentLabel}>View attachment</Text>}</Pressable> : null}
        {pending ? <View style={styles.actions}>
          <Pressable disabled={busyId !== null} onPress={() => void resolve(appeal.appeal_id, "reject")} style={styles.rejectButton}><Text style={styles.rejectLabel}>Reject</Text></Pressable>
          <Pressable disabled={busyId !== null} onPress={() => void resolve(appeal.appeal_id, "accept")} style={styles.acceptButton}>{busyId === appeal.appeal_id ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.acceptLabel}>Accept</Text>}</Pressable>
        </View> : <Text style={styles.resolver}>{resolver}</Text>}
      </View>;
    })}
    <Modal animationType="fade" onRequestClose={() => setImagePreviewUri(null)} transparent visible={Boolean(imagePreviewUri)}>
      <View style={styles.previewBackdrop}>
        <Image resizeMode="contain" source={imagePreviewUri ? { uri: imagePreviewUri } : undefined} style={styles.previewImage} />
        <Pressable onPress={() => setImagePreviewUri(null)} style={styles.previewClose}><Text style={styles.previewCloseLabel}>Close</Text></Pressable>
      </View>
    </Modal>
  </View>;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  list: { gap: theme.spacing.sm, marginTop: theme.spacing.xl },
  card: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, padding: theme.spacing.md },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: theme.spacing.sm, justifyContent: "space-between" },
  identity: { flex: 1 },
  studentName: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  studentId: { color: theme.colors.grey600, marginTop: 2, ...theme.typography.label },
  statusBadge: { borderRadius: theme.radius.button, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  pendingBadge: { backgroundColor: theme.colors.yellow },
  acceptedBadge: { backgroundColor: theme.colors.grey200 },
  rejectedBadge: { backgroundColor: theme.colors.grey200 },
  statusLabel: { color: theme.colors.black, textTransform: "capitalize", ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  course: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  date: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  message: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.body },
  attachmentButton: { alignItems: "center", alignSelf: "flex-start", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", marginTop: theme.spacing.sm, minHeight: 44, paddingHorizontal: theme.spacing.md },
  attachmentLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  acceptButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: theme.spacing.md },
  acceptLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  rejectButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: theme.spacing.md },
  rejectLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  resolver: { color: theme.colors.grey600, marginTop: theme.spacing.md, textTransform: "capitalize", ...theme.typography.label },
  empty: { color: theme.colors.grey600, paddingVertical: theme.spacing.lg, textAlign: "center", ...theme.typography.body },
  error: { color: theme.colors.red, ...theme.typography.label },
  previewBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.94)", flex: 1, justifyContent: "center", padding: theme.spacing.lg },
  previewImage: { flex: 1, width: "100%" },
  previewClose: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.md, minHeight: 48, minWidth: 120, paddingHorizontal: theme.spacing.lg },
  previewCloseLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }
});
