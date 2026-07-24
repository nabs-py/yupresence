import type { TextInputProps } from "react-native";
import { StyleSheet, TextInput } from "react-native";

import { useAppTheme } from "../constants/theme";

export function AuthTextInput(props: TextInputProps) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  return <TextInput placeholderTextColor={theme.colors.grey500} style={styles.input} {...props} />;
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  input: {
    backgroundColor: theme.colors.grey50,
    borderColor: theme.colors.grey200,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    color: theme.colors.black,
    minHeight: 52,
    paddingHorizontal: theme.spacing.lg,
    ...theme.typography.body
  }
});
