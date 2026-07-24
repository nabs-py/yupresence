import { Pressable, StyleSheet, Text } from "react-native";

import { useAppTheme } from "../constants/theme";

export function RetryButton({ onPress }: { onPress: () => void }) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  return <Pressable onPress={onPress} style={styles.button}><Text style={styles.label}>Retry</Text></Pressable>;
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  button: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 48, paddingHorizontal: theme.spacing.xl },
  label: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }
});
