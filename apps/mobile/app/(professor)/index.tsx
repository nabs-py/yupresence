import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { io } from "socket.io-client";

import { AppTheme, useAppTheme } from "../../constants/theme";
import { endAttendance, getActiveProfessorSession, getApiUrl, getProfessorAssignments, startAttendance } from "../../lib/api";
import { SessionReviewPanels } from "../../components/SessionReviewPanels";
import { AnimatedAttendanceCounter } from "../../components/AnimatedAttendanceCounter";
import { RetryButton } from "../../components/RetryButton";
import { useAuthStore } from "../../stores/auth-store";

export default function ProfessorHomeScreen() {
  const appTheme = useAppTheme();
  const styles = createStyles(appTheme);
  const { width } = useWindowDimensions();
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingAssignment, setStartingAssignment] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [liveState, setLiveState] = useState<LiveSessionState | null>(null);
  const assignmentsQuery = useQuery({
    queryKey: ["professor", "assignments"],
    queryFn: () => getProfessorAssignments(token as string),
    enabled: Boolean(token)
  });
  const activeQuery = useQuery({
    queryKey: ["professor", "active-session"],
    queryFn: () => getActiveProfessorSession(token as string),
    enabled: Boolean(token)
  });
  const activeSession = activeQuery.data?.session ?? null;

  useEffect(() => {
    if (!activeSession || !token) {
      setLiveState(null);
      return;
    }

    setLiveState({
      session_id: activeSession.session_id,
      qr_payload: null,
      present_count: activeSession.present_count,
      pending_count: activeSession.pending_count,
      flagged_count: activeSession.flagged_count,
      remaining_seconds: activeSession.expires_at
        ? Math.max(0, Math.ceil((new Date(activeSession.expires_at).getTime() - Date.now()) / 1000))
        : 0
    });

    const socket = io(getApiUrl(), { auth: { token }, transports: ["websocket"] });
    socket.on("connect", () => socket.emit("attendance:join", { session_id: activeSession.session_id }));
    socket.on("attendance:update", (update: LiveSessionState) => {
      if (update.session_id === activeSession.session_id) {
        setLiveState(update);
      }
    });
    socket.on("attendance:ended", ({ session_id }: { session_id: number }) => {
      if (session_id === activeSession.session_id) {
        setLiveState(null);
        void queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
      }
    });
    socket.on("attendance:error", ({ error }: { error: string }) => setActionError(error));
    socket.on("connect_error", (error) => setActionError(error.message));

    return () => {
      socket.disconnect();
    };
  }, [activeSession?.session_id, token, queryClient]);

  async function handleStart(courseId: number, section: string) {
    setActionError(null);
    setStartingAssignment(`${courseId}-${section}`);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Location permission is required to set the classroom attendance area.");
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await startAttendance(token as string, courseId, section, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
      await queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to start attendance.");
    } finally {
      setStartingAssignment(null);
    }
  }

  async function handleEnd() {
    if (!activeSession) return;
    setActionError(null);
    setIsEnding(true);
    try {
      await endAttendance(token as string, activeSession.session_id);
      setShowEndConfirmation(false);
      await queryClient.invalidateQueries({ queryKey: ["professor", "active-session"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to end attendance.");
    } finally {
      setIsEnding(false);
    }
  }

  if (assignmentsQuery.isLoading || activeQuery.isLoading || ((assignmentsQuery.error || activeQuery.error) && (assignmentsQuery.isFetching || activeQuery.isFetching))) {
    return <View style={styles.centered}><ActivityIndicator color={appTheme.colors.black} /><Text style={styles.body}>Loading your sections...</Text></View>;
  }

  if (assignmentsQuery.error || activeQuery.error || !assignmentsQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load attendance</Text><Text style={styles.body}>Please try again.</Text><RetryButton onPress={() => { void assignmentsQuery.refetch(); void activeQuery.refetch(); }} /></View>;
  }

  if (activeSession) {
    return (
      <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{activeSession.course_code}</Text>
        <Text style={styles.activeSection}>Section {activeSession.section}</Text>
              <Text numberOfLines={2} style={styles.courseName}>{activeSession.course_name}</Text>
        <View style={styles.qrCard}>
          <Text style={styles.qrLabel}>Scan this QR</Text>
          {liveState?.qr_payload ? (
            <View style={styles.qrSurface}>
              <QRCode backgroundColor={appTheme.colors.onAccent} color={appTheme.colors.qrInk} size={Math.min(Math.max(width - 112, 180), 260)} value={liveState.qr_payload} />
            </View>
          ) : <ActivityIndicator color={appTheme.colors.black} size="large" />}
          <Text style={styles.qrPlaceholder}>Secure code refreshes every 10 seconds</Text>
        </View>
        <View style={styles.counterRow}>
          <AnimatedAttendanceCounter label="Present" value={liveState?.present_count ?? activeSession.present_count} theme={appTheme} />
          <AnimatedAttendanceCounter label="Pending" value={liveState?.pending_count ?? activeSession.pending_count} theme={appTheme} />
          <AnimatedAttendanceCounter label="Flagged" value={liveState?.flagged_count ?? activeSession.flagged_count} theme={appTheme} />
        </View>
        <SessionReviewPanels sessionId={activeSession.session_id} token={token as string} />
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>Time remaining</Text>
          <Text style={styles.timer}>{formatDuration(liveState?.remaining_seconds ?? 0)}</Text>
        </View>
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        <Pressable disabled={isEnding} onPress={() => setShowEndConfirmation(true)} style={styles.endButton}>
          <Text style={styles.endButtonLabel}>End Session</Text>
        </Pressable>
      </ScrollView>
      <Modal animationType="fade" onRequestClose={() => setShowEndConfirmation(false)} transparent visible={showEndConfirmation}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>End this session?</Text>
            <Text style={styles.modalMessage}>Students will no longer be able to check in.</Text>
            <View style={styles.modalActions}>
              <Pressable disabled={isEnding} onPress={() => setShowEndConfirmation(false)} style={styles.modalCancelButton}>
                <Text style={styles.modalCancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable disabled={isEnding} onPress={() => void handleEnd()} style={styles.modalConfirmButton}>
                <Text style={styles.modalConfirmLabel}>{isEnding ? "Ending..." : "End Session"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Start attendance</Text>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {assignmentsQuery.data.assignments.length === 0 ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No sections assigned</Text><Text style={styles.body}>Your teaching sections will appear here once an admin assigns them.</Text></View> : null}
      {assignmentsQuery.data.assignments.map((assignment) => {
        const key = `${assignment.course_id}-${assignment.section}`;
        return (
          <View key={key} style={styles.assignmentCard}>
            <View style={styles.assignmentInfo}>
              <Text numberOfLines={2} style={styles.assignmentTitle}>{assignment.course_code} — Section {assignment.section}</Text>
              <Text numberOfLines={2} style={styles.courseName}>{assignment.course_name}</Text>
            </View>
            <Pressable disabled={startingAssignment !== null} onPress={() => void handleStart(assignment.course_id, assignment.section)} style={styles.startButton}>
              <Text style={styles.startButtonLabel}>{startingAssignment === key ? "Starting..." : "Start Attendance"}</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

interface LiveSessionState {
  session_id: number;
  qr_payload: string | null;
  present_count: number;
  pending_count: number;
  flagged_count: number;
  remaining_seconds: number;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  eyebrow: { color: theme.colors.grey600, ...theme.typography.label },
  title: { color: theme.colors.black, marginTop: theme.spacing.xs, ...theme.typography.display },
  activeSection: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.heading },
  body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body },
  courseName: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  error: { color: theme.colors.red, marginTop: theme.spacing.lg, ...theme.typography.label },
  assignmentCard: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xl, padding: theme.spacing.lg },
  emptyCard: { alignItems: "center", backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xxl, padding: theme.spacing.xl },
  emptyTitle: { color: theme.colors.black, ...theme.typography.heading },
  assignmentInfo: { minHeight: 58 },
  assignmentTitle: { color: theme.colors.black, ...theme.typography.heading },
  startButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 50, paddingHorizontal: theme.spacing.lg },
  startButtonLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  qrCard: { alignItems: "center", backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, marginTop: theme.spacing.xxl, padding: theme.spacing.xl },
  qrLabel: { color: theme.colors.black, marginBottom: theme.spacing.lg, ...theme.typography.heading },
  qrSurface: { backgroundColor: theme.colors.onAccent, padding: theme.spacing.sm },
  qrPlaceholder: { color: theme.colors.grey600, marginTop: theme.spacing.lg, ...theme.typography.label },
  counterRow: { borderBottomColor: theme.colors.grey200, borderBottomWidth: 1, borderTopColor: theme.colors.grey200, borderTopWidth: 1, flexDirection: "row", marginTop: theme.spacing.xxl, paddingVertical: theme.spacing.lg },
  timerCard: { alignItems: "center", marginTop: theme.spacing.xxl },
  timerLabel: { color: theme.colors.grey600, ...theme.typography.label },
  timer: { color: theme.colors.black, marginTop: theme.spacing.xs, ...theme.typography.hugeStat },
  endButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.xxl, minHeight: 58 },
  endButtonLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.48)", flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, maxWidth: 420, padding: theme.spacing.xl, width: "100%" },
  modalTitle: { color: theme.colors.black, ...theme.typography.heading },
  modalMessage: { color: theme.colors.grey600, marginTop: theme.spacing.sm, ...theme.typography.body },
  modalActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xl },
  modalCancelButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48 },
  modalCancelLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  modalConfirmButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48 },
  modalConfirmLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }
});
