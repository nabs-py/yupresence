import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { AuthTextInput } from "../../components/AuthTextInput";
import { useAppTheme } from "../../constants/theme";
import { login, registerStudentDevice } from "../../lib/api";
import { routeForRole } from "../../lib/auth/routes";
import { getOrCreateDeviceId } from "../../lib/device";
import { useAuthStore } from "../../stores/auth-store";

export default function SignInScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await login(email.trim(), password);

      // A device is bound only as part of the first completed student sign-in.
      // Session hydration and scanning never register or replace a device.
      if (response.user.role === "student" && response.user.device_binding_required) {
        await registerStudentDevice(response.token, await getOrCreateDeviceId());
      }
      const session = await setSession(response.token);
      router.replace(routeForRole(session.role));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", default: undefined })} style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Sign In</Text>

        <View style={styles.form}>
          <AuthTextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            value={email}
          />
          <AuthTextInput
            autoComplete="current-password"
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            value={password}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={isSubmitting} onPress={handleSubmit} style={[styles.primaryButton, isSubmitting && styles.disabledButton]}>
            <Text style={styles.primaryButtonLabel}>{isSubmitting ? "Signing In..." : "Sign In"}</Text>
          </Pressable>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.white,
    flex: 1
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: theme.spacing.xl
  },
  title: {
    color: theme.colors.black,
    ...theme.typography.display
  },
  form: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.xxxl
  },
  error: {
    color: theme.colors.red,
    ...theme.typography.label
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: theme.colors.orange,
    borderRadius: theme.radius.button,
    minHeight: 52,
    justifyContent: "center",
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl
  },
  disabledButton: {
    backgroundColor: theme.colors.grey400
  },
  primaryButtonLabel: {
    color: theme.colors.onAccent,
    ...theme.typography.body,
    fontFamily: theme.fontFamily.semibold
  },
  linkButton: {
    alignSelf: "center",
    marginTop: theme.spacing.xl,
    padding: theme.spacing.sm
  },
  linkLabel: {
    color: theme.colors.grey700,
    ...theme.typography.label
  }
});
