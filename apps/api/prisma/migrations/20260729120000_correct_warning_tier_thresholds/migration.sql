-- Reclassify warning rows created under the previous 4-5/6-7/8+ thresholds.
UPDATE "attendance_warnings"
SET "status" = CASE
    WHEN "absence_count" >= 10 THEN 'critical'
    WHEN "absence_count" >= 7 THEN 'warning'
    WHEN "absence_count" >= 4 THEN 'safe'
    ELSE 'excellent'
END;
