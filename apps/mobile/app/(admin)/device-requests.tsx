import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RetryButton } from "../../components/RetryButton";
import { useAppTheme } from "../../constants/theme";
import { getAdminDeviceChangeRequests, resolveAdminDeviceChangeRequest } from "../../lib/api";
import { formatGregorianDateTime } from "../../lib/date";
import { useAuthStore } from "../../stores/auth-store";

export default function AdminDeviceRequestsScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestsQuery = useQuery({
    queryKey: ["admin", "device-change-requests", filter],
    queryFn: () => getAdminDeviceChangeRequests(token as string, filter),
    enabled: Boolean(token),
    refetchInterval: filter === "pending" ? 2_000 : false
  });

  async function resolve(requestId: number, decision: "grant" | "reject") {
    setBusyId(requestId);
    setActionError(null);
    try {
      await resolveAdminDeviceChangeRequest(token as string, requestId, decision);
      await queryClient.invalidateQueries({ queryKey: ["admin", "device-change-requests"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update this request.");
    } finally {
      setBusyId(null);
    }
  }

  if (requestsQuery.isLoading || (requestsQuery.isFetching && !requestsQuery.data)) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.black} /><Text style={styles.body}>Loading device requests...</Text></View>;
  }
  if (requestsQuery.error || !requestsQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load device requests</Text><RetryButton onPress={() => void requestsQuery.refetch()} /></View>;
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backLabel}>‹ Admin</Text></Pressable>
    <Text style={styles.title}>Device Change Requests</Text>
    <View style={styles.filter}><Pressable onPress={() => setFilter("pending")} style={[styles.filterButton, filter === "pending" && styles.filterButtonActive]}><Text style={[styles.filterLabel, filter === "pending" && styles.filterLabelActive]}>Pending</Text></Pressable><Pressable onPress={() => setFilter("all")} style={[styles.filterButton, filter === "all" && styles.filterButtonActive]}><Text style={[styles.filterLabel, filter === "all" && styles.filterLabelActive]}>All requests</Text></Pressable></View>
    {actionError ? <Text style={styles.reason}>{actionError}</Text> : null}
    {requestsQuery.data.requests.length === 0 ? <Text style={styles.empty}>{filter === "pending" ? "No device change requests are waiting for review." : "No device change requests yet."}</Text> : requestsQuery.data.requests.map((item) => <View key={item.request_id} style={styles.card}>
      <View style={styles.cardHeader}><View style={styles.identity}><Text numberOfLines={1} style={styles.name}>{item.student_name}</Text><Text style={styles.studentId}>Student ID: {item.student_id}</Text></View><Text style={styles.status}>{item.status}</Text></View>
      <Text style={styles.date}>Submitted {formatGregorianDateTime(item.created_at)}</Text>
      <Text style={styles.reason}>{item.reason}</Text>
      {item.status === "pending" ? <View style={styles.actions}><Pressable disabled={busyId !== null} onPress={() => void resolve(item.request_id, "reject")} style={styles.reject}><Text style={styles.rejectLabel}>Reject</Text></Pressable><Pressable disabled={busyId !== null} onPress={() => void resolve(item.request_id, "grant")} style={styles.grant}><Text style={styles.grantLabel}>{busyId === item.request_id ? "Saving..." : "Grant"}</Text></Pressable></View> : <Text style={styles.resolved}>Resolved {item.status}{item.granted_at ? ` · granted ${formatGregorianDateTime(item.granted_at)}` : ""}</Text>}
    </View>)}
  </ScrollView>;
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 }, content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge }, centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl }, back: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44 }, backLabel: { color: theme.colors.grey600, ...theme.typography.body }, title: { color: theme.colors.black, marginTop: theme.spacing.md, ...theme.typography.display }, filter: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.button, flexDirection: "row", gap: theme.spacing.xs, marginTop: theme.spacing.xl, padding: theme.spacing.xs }, filterButton: { alignItems: "center", borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.sm }, filterButtonActive: { backgroundColor: theme.colors.orange }, filterLabel: { color: theme.colors.grey600, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, filterLabelActive: { color: theme.colors.onAccent }, card: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, marginTop: theme.spacing.md, padding: theme.spacing.md }, cardHeader: { alignItems: "flex-start", flexDirection: "row", gap: theme.spacing.sm, justifyContent: "space-between" }, identity: { flex: 1 }, name: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }, studentId: { color: theme.colors.grey600, marginTop: 2, ...theme.typography.label }, status: { color: theme.colors.orange, textTransform: "capitalize", ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, date: { color: theme.colors.grey600, marginTop: theme.spacing.sm, ...theme.typography.label }, reason: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.body }, actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }, reject: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48 }, rejectLabel: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, grant: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48 }, grantLabel: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold }, resolved: { color: theme.colors.grey600, marginTop: theme.spacing.md, textTransform: "capitalize", ...theme.typography.label }, empty: { color: theme.colors.grey600, marginTop: theme.spacing.xl, textAlign: "center", ...theme.typography.body }, body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body }
});
