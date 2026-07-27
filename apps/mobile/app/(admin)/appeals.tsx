import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppealReviewList } from "../../components/AppealReviewList";
import { RetryButton } from "../../components/RetryButton";
import { useAppTheme } from "../../constants/theme";
import { getAppeals } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";

export default function AdminAppealsScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const appealsQuery = useQuery({ queryKey: ["admin", "appeals"], queryFn: () => getAppeals(token as string), enabled: Boolean(token), refetchInterval: 2_000 });

  if (appealsQuery.isLoading || (appealsQuery.isFetching && !appealsQuery.data)) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.black} /><Text style={styles.body}>Loading appeals...</Text></View>;
  }
  if (appealsQuery.error || !appealsQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load appeals</Text><RetryButton onPress={() => void appealsQuery.refetch()} /></View>;
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backLabel}>‹ Admin</Text></Pressable>
    <Text style={styles.title}>Student Appeals</Text>
    <AppealReviewList appeals={appealsQuery.data.appeals} emptyLabel="No student appeals have been submitted." onResolved={() => appealsQuery.refetch()} token={token as string} />
  </ScrollView>;
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  back: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44 },
  backLabel: { color: theme.colors.grey600, ...theme.typography.body },
  title: { color: theme.colors.black, marginBottom: theme.spacing.xl, ...theme.typography.display },
  body: { color: theme.colors.grey600, marginTop: theme.spacing.md, ...theme.typography.body }
});
