import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { AppTheme, useAppTheme } from "../../constants/theme";
import { scanAttendance } from "../../lib/api";
import { getOrCreateDeviceId } from "../../lib/device";
import { useAuthStore } from "../../stores/auth-store";

type ScanState =
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "failure"; code?: string; message: string };

export default function StudentScanScreen() {
  const appTheme = useAppTheme();
  const styles = createStyles(appTheme);
  const { width } = useWindowDimensions();
  const token = useAuthStore((state) => state.token);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);
  const [scanState, setScanState] = useState<ScanState>({ kind: "preparing" });
  const locationRef = useRef<Location.LocationObject | null>(null);
  const scanLockedRef = useRef(false);
  const successScale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    void (async () => {
      const [cameraResult, locationResult] = await Promise.all([
        cameraPermission?.granted ? Promise.resolve(cameraPermission) : requestCameraPermission(),
        Location.requestForegroundPermissionsAsync()
      ]);

      if (!cameraResult.granted) {
        setScanState({ kind: "failure", message: "Camera permission is required to scan attendance." });
        return;
      }
      if (locationResult.status !== "granted") {
        setScanState({ kind: "failure", message: "Location permission is required to verify attendance." });
        return;
      }
      if (!token) {
        setScanState({ kind: "failure", message: "Your sign-in session is unavailable. Sign in again." });
        return;
      }

      try {
        // Acquire the GPS fix before scanning begins. Scan-time must only read this cached value.
        const cachedLocation = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 100 });
        locationRef.current = cachedLocation;
        const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        locationRef.current = currentLocation;
        scanLockedRef.current = false;
        setLocationGranted(true);
        setScanState({ kind: "ready" });
      } catch (error) {
        setScanState({ kind: "failure", message: error instanceof Error ? error.message : "Unable to prepare the scanner." });
      }
    })();
  }, [cameraPermission?.granted, requestCameraPermission, token]);

  useFocusEffect(useCallback(() => {
    scanLockedRef.current = false;
    if (locationRef.current && cameraPermission?.granted && token) {
      setScanState({ kind: "ready" });
    }

    return () => {
      scanLockedRef.current = true;
    };
  }, [cameraPermission?.granted, token]));

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scanLockedRef.current || scanState.kind !== "ready" || !token) {
      return;
    }

    // Expo Camera may report the same visible QR several times before React rerenders.
    scanLockedRef.current = true;
    setScanState({ kind: "submitting" });
    try {
      const [deviceId, location] = await Promise.all([getOrCreateDeviceId(), Promise.resolve(locationRef.current)]);
      if (!location) {
        throw new Error("LOCATION_UNAVAILABLE: Location is still being acquired. Please try again.");
      }
      const response = await scanAttendance(token, {
        qrPayload: result.data,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        deviceId
      });
      setScanState({
        kind: "success",
        message: response.status === "already_present"
          ? `You're already verified for ${response.session.course_code} — Section ${response.session.section}.`
          : `You're marked present for ${response.session.course_code} — Section ${response.session.section}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Attendance scan failed.";
      const code = /^([A-Z_]+):\s/.exec(message)?.[1];
      setScanState({ kind: "failure", code, message: message.replace(/^[A-Z_]+:\s/, "") });
    }
  }

  function retryScan() {
    scanLockedRef.current = false;
    setScanState({ kind: "ready" });
  }

  useEffect(() => {
    if (scanState.kind !== "success") {
      return;
    }

    const redirect = setTimeout(() => router.replace("/(student)"), 1_500);
    return () => clearTimeout(redirect);
  }, [scanState.kind]);

  useEffect(() => {
    if (scanState.kind === "success") {
      successScale.setValue(0.7);
      Animated.spring(successScale, { toValue: 1, friction: 4, tension: 110, useNativeDriver: true }).start();
    }
  }, [scanState.kind, successScale]);

  const canScan = scanState.kind === "ready" && locationGranted;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Scan attendance</Text>
      </View>

      <View style={styles.cameraFrame}>
        {cameraPermission?.granted && locationGranted ? (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={canScan ? handleBarcodeScanned : undefined}
            style={StyleSheet.absoluteFill}
          />
        ) : <View style={styles.cameraFallback}><ActivityIndicator color={appTheme.colors.black} size="large" /></View>}
        <View pointerEvents="none" style={[styles.scanGuide, { width: Math.min(Math.max(width * 0.55, 160), 230) }]} />
      </View>

      {scanState.kind === "preparing" || scanState.kind === "submitting" ? (
        <View style={styles.feedback}><ActivityIndicator color={appTheme.colors.black} /><Text style={styles.feedbackText}>{scanState.kind === "submitting" ? "Verifying your attendance..." : "Preparing camera and location..."}</Text></View>
      ) : null}
      {scanState.kind === "success" ? (
        <View style={styles.feedback}><Animated.View style={[styles.successMark, { transform: [{ scale: successScale }] }]}><Text style={styles.successCheck}>✓</Text></Animated.View><Text style={styles.successTitle}>Attendance confirmed</Text><Text style={styles.feedbackText}>{scanState.message}</Text><Text style={styles.redirectText}>Returning to Home...</Text></View>
      ) : null}
      {scanState.kind === "failure" ? (
        <View style={styles.feedback}><Text style={styles.failureTitle}>{scanState.code ?? "Scan failed"}</Text><Text style={styles.feedbackText}>{scanState.message}</Text><Pressable onPress={retryScan} style={styles.primaryButton}><Text style={styles.primaryLabel}>Scan again</Text></Pressable></View>
      ) : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1, padding: theme.spacing.xl },
  header: {},
  title: { color: theme.colors.black, ...theme.typography.display },
  cameraFrame: { alignItems: "center", backgroundColor: theme.colors.grey100, borderRadius: theme.radius.card, flex: 1, justifyContent: "center", marginTop: theme.spacing.xxl, overflow: "hidden" },
  cameraFallback: { alignItems: "center", flex: 1, justifyContent: "center" },
  scanGuide: { aspectRatio: 1, borderColor: theme.colors.white, borderRadius: theme.radius.sm, borderWidth: 3 },
  feedback: { backgroundColor: theme.colors.grey50, borderRadius: theme.radius.card, gap: theme.spacing.sm, marginTop: theme.spacing.lg, padding: theme.spacing.lg },
  feedbackText: { color: theme.colors.grey700, ...theme.typography.body },
  successTitle: { color: theme.colors.black, ...theme.typography.heading },
  successMark: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.colors.orange, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  successCheck: { color: theme.colors.onAccent, fontFamily: theme.fontFamily.bold, fontSize: 26, lineHeight: 30 },
  redirectText: { color: theme.colors.grey500, ...theme.typography.label },
  failureTitle: { color: theme.colors.black, ...theme.typography.heading },
  primaryButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", marginTop: theme.spacing.sm, minHeight: 50 },
  primaryLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }
});
