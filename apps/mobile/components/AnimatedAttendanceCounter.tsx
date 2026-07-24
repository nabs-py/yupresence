import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { type AppTheme } from "../constants/theme";

export function AnimatedAttendanceCounter({ label, theme, value }: { label: string; theme: AppTheme; value: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const previousValue = useRef<number | null>(null);

  useEffect(() => {
    if (previousValue.current !== null && previousValue.current !== value) {
      scale.setValue(1);
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 120, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true })
      ]).start();
    }
    previousValue.current = value;
  }, [scale, value]);

  return <View style={styles.counter}><Animated.Text style={[styles.value, { color: theme.colors.black, fontFamily: theme.fontFamily.semibold, transform: [{ scale }] }]}>{value}</Animated.Text><Text style={[styles.label, { color: theme.colors.grey600, fontFamily: theme.fontFamily.medium }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  counter: { alignItems: "center", flex: 1 },
  value: { fontSize: 24, lineHeight: 32 },
  label: { fontSize: 13, lineHeight: 18, marginTop: 4 }
});
