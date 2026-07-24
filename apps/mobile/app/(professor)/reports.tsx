import { File, Paths } from "expo-file-system";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme, useAppTheme } from "../../constants/theme";
import { exportProfessorAttendanceCsv, getProfessorReports } from "../../lib/api";
import { formatGregorianDate, formatGregorianDateTime } from "../../lib/date";
import { useAuthStore } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { RetryButton } from "../../components/RetryButton";

interface SectionSelection {
  courseId: number;
  courseCode: string;
  section: string;
}

interface ReportsFilter {
  sort: "newest" | "oldest";
  section: SectionSelection | null;
  dateFrom: string | null;
  dateTo: string | null;
}

const defaultReportsFilter: ReportsFilter = {
  sort: "newest",
  section: null,
  dateFrom: null,
  dateTo: null
};

function toInputDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseInputDate(value: string | null): Date {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function ProfessorReportsScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const token = useAuthStore((state) => state.token);
  const isDark = useThemeStore((state) => state.isDark);
  const deviceTimezoneOffsetMinutes = new Date().getTimezoneOffset();
  const [filter, setFilter] = useState<ReportsFilter>(defaultReportsFilter);
  const [draftFilter, setDraftFilter] = useState<ReportsFilter>(defaultReportsFilter);
  const [showFilter, setShowFilter] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const reportsQuery = useInfiniteQuery({
    queryKey: ["professor", "reports", filter.sort, filter.section?.courseId ?? "all", filter.section?.section ?? "all", filter.dateFrom ?? "all", filter.dateTo ?? "all"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getProfessorReports(token as string, {
      offset: pageParam,
      courseId: filter.section?.courseId,
      section: filter.section?.section,
      sort: filter.sort,
      dateFrom: filter.dateFrom ?? undefined,
      dateTo: filter.dateTo ?? undefined,
      timezoneOffsetMinutes: deviceTimezoneOffsetMinutes
    }),
    getNextPageParam: (lastPage) => lastPage.pagination.has_more
      ? lastPage.pagination.offset + lastPage.pagination.limit
      : undefined,
    enabled: Boolean(token)
  });

  if (reportsQuery.isLoading || (reportsQuery.isFetching && !reportsQuery.data)) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.black} /><Text style={styles.body}>Loading reports...</Text></View>;
  }
  if (reportsQuery.error || !reportsQuery.data) {
    return <View style={styles.centered}><Text style={styles.title}>Unable to load reports</Text><Text style={styles.body}>Please try again.</Text><RetryButton onPress={() => void reportsQuery.refetch()} /></View>;
  }

  const firstPage = reportsQuery.data.pages[0];
  const sections = firstPage?.sections ?? [];
  const sessions = reportsQuery.data.pages.flatMap((page) => page.recent_sessions);
  const defaulters = sections.flatMap((section) => section.defaulters.map((student) => ({
    ...student,
    courseCode: section.course_code,
    section: section.section
  }))).sort((left, right) => {
    if (left.status !== right.status) return left.status === "critical" ? -1 : 1;
    return right.absence_count - left.absence_count;
  });

  const filterIsActive = filter.sort !== "newest" || Boolean(filter.section) || Boolean(filter.dateFrom) || Boolean(filter.dateTo);

  function openFilter() {
    setDraftFilter(filter);
    setFilterError(null);
    setShowFilter(true);
  }

  function applyFilter() {
    if (draftFilter.dateFrom && draftFilter.dateTo && draftFilter.dateFrom > draftFilter.dateTo) {
      setFilterError("The end date must be on or after the start date.");
      return;
    }
    setFilter(draftFilter);
    setFilterError(null);
    setShowFilter(false);
  }

  function resetFilter() {
    setDraftFilter(defaultReportsFilter);
    setFilter(defaultReportsFilter);
    setFilterError(null);
    setShowFilter(false);
  }

  async function exportCsv(selection: SectionSelection | null) {
    setExportError(null);
    setIsExporting(true);
    try {
      const result = await exportProfessorAttendanceCsv(token as string, selection ? {
        courseId: selection.courseId,
        section: selection.section
      } : undefined);

      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, result.filename);
        file.write(result.csv);
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error("File sharing is unavailable on this device.");
        }
        await Sharing.shareAsync(file.uri, {
          dialogTitle: "Export attendance CSV",
          mimeType: "text/csv",
          UTI: "public.comma-separated-values-text"
        });
      }
      setShowExport(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Unable to export attendance.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.reportNav}>
          <Pressable style={[styles.reportNavButton, styles.reportNavButtonActive]}>
            <Text style={styles.reportNavLabelActive}>Past Sessions</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(professor)/analytics")} style={styles.reportNavButton}>
            <Text style={styles.reportNavLabel}>Analytics</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHeading}>Past Sessions</Text>
        <View style={styles.sessionGrid}>
          <Pressable onPress={openFilter} style={styles.filterButton}>
            <View>
              <Text style={styles.filterCaption}>Sort / filter</Text>
              <Text style={styles.filterValue}>{filter.section ? `${filter.section.courseCode} · Section ${filter.section.section}` : "All sections"}</Text>
            </View>
            <View style={styles.filterControlFooter}>
              {filterIsActive ? <View style={styles.filterDot} /> : null}
              <Text style={styles.chevron}>⌄</Text>
            </View>
          </Pressable>

          {sessions.length === 0 ? <Text style={styles.empty}>No ended sessions match this filter.</Text> : sessions.map((session) => (
            <Pressable key={session.session_id} onPress={() => router.push(`/(professor)/session/${session.session_id}`)} style={styles.sessionCard}>
              <View style={styles.sessionMain}>
                <Text numberOfLines={1} style={styles.sessionTitle}>{session.course_code} · Section {session.section}</Text>
                <Text numberOfLines={2} style={styles.sessionName}>{session.course_name}</Text>
                <Text numberOfLines={1} style={styles.sessionDate}>{session.ended_at ? formatGregorianDateTime(session.ended_at) : "Ended session"}</Text>
              </View>
              <Text style={styles.openLabel}>Open</Text>
            </Pressable>
          ))}
        </View>

        {reportsQuery.hasNextPage ? (
          <Pressable disabled={reportsQuery.isFetchingNextPage} onPress={() => void reportsQuery.fetchNextPage()} style={styles.loadMoreButton}>
            {reportsQuery.isFetchingNextPage
              ? <ActivityIndicator color={theme.colors.black} />
              : <Text style={styles.loadMoreLabel}>Load More</Text>}
          </Pressable>
        ) : sessions.length > 0 ? <Text style={styles.endLabel}>All sessions loaded</Text> : null}

        <Text style={styles.sectionHeading}>Attendance Watchlist</Text>
        {defaulters.length === 0 ? <Text style={styles.empty}>No students are currently in Warning or Critical.</Text> : defaulters.map((student) => (
          <View key={`${student.courseCode}-${student.section}-${student.student_id}`} style={styles.defaulterCard}>
            <View style={styles.studentMain}>
              <Text numberOfLines={1} style={styles.studentName}>{student.name}</Text>
              <Text numberOfLines={1} style={styles.studentMeta}>Student ID: {student.student_id}</Text>
              <Text numberOfLines={1} style={styles.studentMeta}>{student.courseCode} · Section {student.section} · {student.absence_count} absences</Text>
            </View>
            <View style={[styles.tierBadge, student.status === "critical" ? styles.criticalBadge : styles.warningBadge]}>
              <Text style={[styles.tierLabel, student.status === "critical" ? styles.criticalLabel : styles.warningLabel]}>
                {student.status === "critical" ? "Critical" : "Warning"}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.exportFooter}>
          <Pressable onPress={() => setShowExport(true)} style={styles.exportButton}>
            <Text style={styles.exportButtonLabel}>Export CSV</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ReportsFilterModal
        draft={draftFilter}
        error={filterError}
        onApply={applyFilter}
        onChange={setDraftFilter}
        onClose={() => setShowFilter(false)}
        onReset={resetFilter}
        sections={sections.map((section) => ({ courseId: section.course_id, courseCode: section.course_code, section: section.section }))}
        isDark={isDark}
        theme={theme}
        visible={showFilter}
      />
      <SelectionModal
        busy={isExporting}
        error={exportError}
        onClose={() => { if (!isExporting) { setShowExport(false); setExportError(null); } }}
        onSelect={(selection) => void exportCsv(selection)}
        sections={sections.map((section) => ({ courseId: section.course_id, courseCode: section.course_code, section: section.section }))}
        theme={theme}
        title="Export attendance"
        visible={showExport}
      />
    </>
  );
}

function ReportsFilterModal({ draft, error, isDark, onApply, onChange, onClose, onReset, sections, theme, visible }: {
  draft: ReportsFilter;
  error: string | null;
  isDark: boolean;
  onApply: () => void;
  onChange: (filter: ReportsFilter) => void;
  onClose: () => void;
  onReset: () => void;
  sections: SectionSelection[];
  theme: AppTheme;
  visible: boolean;
}) {
  const styles = createStyles(theme);
  const [pickerField, setPickerField] = useState<"from" | "to" | null>(null);

  function handleDateChange(event: DateTimePickerEvent, date?: Date) {
    if (event.type === "dismissed" || !date) {
      setPickerField(null);
      return;
    }
    const value = toInputDate(date);
    onChange({ ...draft, [pickerField === "from" ? "dateFrom" : "dateTo"]: value });
    if (Platform.OS !== "ios") setPickerField(null);
  }

  function openDatePicker(field: "from" | "to") {
    const key = field === "from" ? "dateFrom" : "dateTo";

    // iOS does not fire onChange when the picker opens on its already-selected
    // value, so persist that displayed date before the user taps Done.
    if (!draft[key]) {
      onChange({ ...draft, [key]: toInputDate(new Date()) });
    }
    setPickerField(field);
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable onPress={() => undefined} style={styles.filterModalCard}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Sort & Filter Sessions</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.filterSectionTitle}>Sort</Text>
            <View style={styles.choiceGroup}>
              {(["newest", "oldest"] as const).map((sort) => (
                <Pressable key={sort} onPress={() => onChange({ ...draft, sort })} style={[styles.choice, draft.sort === sort && styles.choiceActive]}>
                  <Text style={[styles.choiceLabel, draft.sort === sort && styles.choiceLabelActive]}>{sort === "newest" ? "Newest first" : "Oldest first"}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.filterSectionTitle}>Course-section</Text>
            <View style={styles.sectionChoiceGrid}>
              {sections.map((section) => {
                const selected = draft.section?.courseId === section.courseId && draft.section.section === section.section;
                return <Pressable key={`${section.courseId}-${section.section}`} onPress={() => onChange({ ...draft, section: selected ? null : section })} style={[styles.sectionChoice, selected && styles.sectionChoiceActive]}>
                  <Text style={[styles.sectionChoiceLabel, selected && styles.sectionChoiceLabelActive]}>{section.courseCode}</Text>
                  <Text style={[styles.sectionChoiceMeta, selected && styles.sectionChoiceLabelActive]}>Section {section.section}</Text>
                </Pressable>;
              })}
            </View>

            <Text style={styles.filterSectionTitle}>Date range</Text>
            <View style={styles.dateFieldsRow}>
              <DateField label="From" value={draft.dateFrom} onClear={() => onChange({ ...draft, dateFrom: null })} onPress={() => openDatePicker("from")} styles={styles} />
              <DateField label="Through" value={draft.dateTo} onClear={() => onChange({ ...draft, dateTo: null })} onPress={() => openDatePicker("to")} styles={styles} />
            </View>
            {pickerField ? <View style={styles.datePickerWrap}>
              <DateTimePicker
                display={Platform.OS === "ios" ? "spinner" : "default"}
                mode="date"
                onChange={handleDateChange}
                themeVariant={isDark ? "dark" : "light"}
                value={parseInputDate(pickerField === "from" ? draft.dateFrom : draft.dateTo)}
              />
              {Platform.OS === "ios" ? <Pressable onPress={() => setPickerField(null)} style={styles.pickerDone}><Text style={styles.pickerDoneLabel}>Done</Text></Pressable> : null}
            </View> : null}

            <View style={styles.filterActions}>
              <Pressable onPress={onReset} style={styles.resetButton}><Text style={styles.resetLabel}>Reset</Text></Pressable>
              <Pressable onPress={onApply} style={styles.applyButton}><Text style={styles.applyLabel}>Apply</Text></Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DateField({ label, onClear, onPress, styles, value }: {
  label: string;
  onClear: () => void;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  value: string | null;
}) {
  return <View style={styles.dateField}>
    <Pressable onPress={onPress} style={styles.dateFieldMain}>
      <Text style={styles.dateFieldLabel}>{label}</Text>
      <Text style={styles.dateFieldValue}>{value ? formatGregorianDate(parseInputDate(value)) : "Choose date"}</Text>
    </Pressable>
    {value ? <Pressable onPress={onClear} style={styles.dateClear}><Text style={styles.dateClearLabel}>Clear</Text></Pressable> : null}
  </View>;
}

function SelectionModal({ busy = false, error, onClose, onSelect, sections, theme, title, visible }: {
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (selection: SectionSelection | null) => void;
  sections: SectionSelection[];
  theme: AppTheme;
  title: string;
  visible: boolean;
}) {
  const styles = createStyles(theme);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable onPress={() => undefined} style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>Choose one course-section or include everything you teach.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={() => onSelect(null)} style={styles.modalOption}>
            <Text style={styles.modalOptionTitle}>All my sections</Text>
            <Text style={styles.modalOptionMeta}>Combined, still separated by section</Text>
          </Pressable>
          {sections.map((section) => (
            <Pressable disabled={busy} key={`${section.courseId}-${section.section}`} onPress={() => onSelect(section)} style={styles.modalOption}>
              <Text style={styles.modalOptionTitle}>{section.courseCode} · Section {section.section}</Text>
            </Pressable>
          ))}
          {busy ? <ActivityIndicator color={theme.colors.black} style={styles.modalBusy} /> : null}
          <Pressable disabled={busy} onPress={onClose} style={styles.modalCancel}>
            <Text style={styles.modalCancelLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { backgroundColor: theme.colors.white, flex: 1 },
  content: { padding: theme.spacing.xl, paddingBottom: theme.spacing.huge },
  centered: { alignItems: "center", backgroundColor: theme.colors.white, flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  reportNav: { backgroundColor: theme.colors.grey100, borderRadius: theme.radius.button, flexDirection: "row", gap: theme.spacing.xs, padding: theme.spacing.xs },
  reportNavButton: { alignItems: "center", borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: theme.spacing.md },
  reportNavButtonActive: { backgroundColor: theme.colors.orange },
  reportNavLabel: { color: theme.colors.grey700, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  reportNavLabelActive: { color: theme.colors.onAccent, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  title: { color: theme.colors.black, ...theme.typography.display },
  body: { color: theme.colors.grey600, marginTop: theme.spacing.sm, ...theme.typography.body },
  sectionHeading: { color: theme.colors.black, marginTop: theme.spacing.xxl, ...theme.typography.heading },
  sessionGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.lg },
  filterButton: { alignItems: "flex-start", backgroundColor: theme.colors.grey50, borderColor: theme.colors.orange, borderRadius: theme.radius.control, borderWidth: 1, justifyContent: "space-between", minHeight: 96, padding: theme.spacing.md, width: "48%" },
  filterCaption: { color: theme.colors.grey500, ...theme.typography.label },
  filterValue: { color: theme.colors.black, marginTop: theme.spacing.xs, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  chevron: { color: theme.colors.orange, fontSize: 18 },
  filterControlFooter: { alignItems: "center", flexDirection: "row", gap: theme.spacing.sm },
  filterDot: { backgroundColor: theme.colors.orange, borderRadius: 4, height: 7, width: 7 },
  sessionCard: { backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, minHeight: 96, padding: theme.spacing.md, width: "48%" },
  sessionMain: { flex: 1 },
  sessionTitle: { color: theme.colors.black, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  sessionName: { color: theme.colors.grey600, marginTop: 2, ...theme.typography.label },
  sessionDate: { color: theme.colors.grey500, marginTop: theme.spacing.xs, ...theme.typography.label },
  openLabel: { color: theme.colors.black, marginTop: theme.spacing.sm, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  loadMoreButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 48 },
  loadMoreLabel: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  endLabel: { color: theme.colors.grey500, marginTop: theme.spacing.lg, textAlign: "center", ...theme.typography.label },
  defaulterCard: { alignItems: "flex-start", backgroundColor: theme.colors.grey50, borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.sm, padding: theme.spacing.md },
  studentMain: { flex: 1 },
  studentName: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  studentMeta: { color: theme.colors.grey600, marginTop: theme.spacing.xs, ...theme.typography.label },
  tierBadge: { borderRadius: theme.radius.button, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  criticalBadge: { backgroundColor: theme.colors.red },
  warningBadge: { backgroundColor: theme.colors.yellow },
  tierLabel: { ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  criticalLabel: { color: theme.colors.onAccent },
  warningLabel: { color: theme.colors.black },
  empty: { color: theme.colors.grey600, marginTop: theme.spacing.lg, textAlign: "center", ...theme.typography.body },
  exportFooter: { marginTop: theme.spacing.xxl },
  exportButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, justifyContent: "center", minHeight: 48 },
  exportButtonLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  modalBackdrop: { backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "center", padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, maxHeight: "80%", padding: theme.spacing.xl },
  filterModalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, maxHeight: "90%", padding: theme.spacing.xl },
  modalTitle: { color: theme.colors.black, ...theme.typography.heading },
  modalMessage: { color: theme.colors.grey600, marginBottom: theme.spacing.md, marginTop: theme.spacing.xs, ...theme.typography.label },
  filterSectionTitle: { color: theme.colors.black, marginTop: theme.spacing.lg, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  choiceGroup: { backgroundColor: theme.colors.grey100, borderRadius: theme.radius.button, flexDirection: "row", gap: theme.spacing.xs, marginTop: theme.spacing.sm, padding: theme.spacing.xs },
  choice: { alignItems: "center", borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.sm },
  choiceActive: { backgroundColor: theme.colors.orange },
  choiceLabel: { color: theme.colors.grey700, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  choiceLabelActive: { color: theme.colors.onAccent },
  sectionChoiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  sectionChoice: { borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, minHeight: 58, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, width: "48%" },
  sectionChoiceActive: { backgroundColor: theme.colors.orange, borderColor: theme.colors.orange },
  sectionChoiceLabel: { color: theme.colors.grey700, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  sectionChoiceMeta: { color: theme.colors.grey500, marginTop: 2, ...theme.typography.label },
  sectionChoiceLabelActive: { color: theme.colors.onAccent },
  dateFieldsRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  dateField: { alignItems: "center", borderColor: theme.colors.grey200, borderRadius: theme.radius.control, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 54, minWidth: 0, paddingLeft: theme.spacing.md },
  dateFieldMain: { flex: 1, paddingVertical: theme.spacing.sm },
  dateFieldLabel: { color: theme.colors.grey500, ...theme.typography.label },
  dateFieldValue: { color: theme.colors.black, marginTop: 2, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  dateClear: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: theme.spacing.md },
  dateClearLabel: { color: theme.colors.grey600, ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  datePickerWrap: { alignItems: "center", backgroundColor: theme.colors.grey50, borderRadius: theme.radius.control, marginTop: theme.spacing.sm, overflow: "hidden", padding: theme.spacing.sm },
  pickerDone: { alignSelf: "stretch", alignItems: "center", borderTopColor: theme.colors.grey200, borderTopWidth: 1, justifyContent: "center", marginTop: theme.spacing.xs, minHeight: 44 },
  pickerDoneLabel: { color: theme.colors.black, textAlign: "center", ...theme.typography.label, fontFamily: theme.fontFamily.semibold },
  filterActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xl },
  resetButton: { alignItems: "center", borderColor: theme.colors.grey300, borderRadius: theme.radius.button, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48 },
  resetLabel: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  applyButton: { alignItems: "center", backgroundColor: theme.colors.orange, borderRadius: theme.radius.button, flex: 1, justifyContent: "center", minHeight: 48 },
  applyLabel: { color: theme.colors.onAccent, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  modalOption: { borderBottomColor: theme.colors.grey200, borderBottomWidth: 1, justifyContent: "center", minHeight: 48, paddingVertical: theme.spacing.md },
  modalOptionTitle: { color: theme.colors.black, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  modalOptionMeta: { color: theme.colors.grey500, marginTop: 2, ...theme.typography.label },
  modalBusy: { marginTop: theme.spacing.md },
  modalCancel: { alignItems: "center", justifyContent: "center", marginTop: theme.spacing.lg, minHeight: 44, paddingVertical: theme.spacing.sm },
  modalCancelLabel: { color: theme.colors.grey700, ...theme.typography.body, fontFamily: theme.fontFamily.semibold },
  error: { color: theme.colors.red, marginVertical: theme.spacing.sm, ...theme.typography.label }
});
