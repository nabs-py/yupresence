import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../constants/theme";

interface Option {
  label: string;
  value: string;
}

export function AdminSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Option[]; value: string }) {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value)?.label ?? "Select";

  return <>
    <Pressable onPress={() => setOpen(true)} style={styles.control}>
      <Text style={styles.label}>{label}</Text>
      <Text numberOfLines={1} style={styles.value}>{selected}</Text>
    </Pressable>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      <Pressable onPress={() => setOpen(false)} style={styles.backdrop}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <Text style={styles.title}>{label}</Text>
          <ScrollView style={styles.options}>
            {options.map((option) => <Pressable key={option.value} onPress={() => { onChange(option.value); setOpen(false); }} style={[styles.option, option.value === value && styles.optionActive]}>
              <Text style={[styles.optionLabel, option.value === value && styles.optionLabelActive]}>{option.label}</Text>
            </Pressable>)}
          </ScrollView>
          <Pressable onPress={() => setOpen(false)} style={styles.cancel}><Text style={styles.cancelLabel}>Cancel</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  control: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, minHeight: 56, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  label: { color: theme.colors.grey500, ...theme.typography.label },
  value: { color: theme.colors.black, marginTop: 2, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  backdrop: { backgroundColor: "rgba(0,0,0,0.65)", flex: 1, justifyContent: "flex-end", padding: theme.spacing.lg },
  sheet: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, maxHeight: "75%", padding: theme.spacing.xl },
  title: { color: theme.colors.black, ...theme.typography.heading },
  options: { marginTop: theme.spacing.md },
  option: { borderBottomColor: theme.colors.grey200, borderBottomWidth: 1, justifyContent: "center", minHeight: 48, paddingVertical: theme.spacing.sm },
  optionActive: { backgroundColor: theme.colors.grey100, borderRadius: theme.radius.control, borderBottomWidth: 0, paddingHorizontal: theme.spacing.md },
  optionLabel: { color: theme.colors.black, ...theme.typography.body },
  optionLabelActive: { fontFamily: theme.fontFamily.semibold },
  cancel: { alignItems: "center", justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 48 },
  cancelLabel: { color: theme.colors.grey700, ...theme.typography.body, fontFamily: theme.fontFamily.semibold }
});
