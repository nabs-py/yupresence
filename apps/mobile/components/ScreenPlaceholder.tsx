import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../constants/theme";

interface ScreenPlaceholderProps {
  title: string;
}

export function ScreenPlaceholder({ title }: ScreenPlaceholderProps) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: theme.colors.white,
    flex: 1,
    justifyContent: "center",
    padding: theme.spacing.xl
  },
  title: {
    color: theme.colors.black,
    ...theme.typography.heading
  }
});
