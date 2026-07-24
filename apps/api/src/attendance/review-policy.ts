// These are categorical boundary rejections, not technical failures a professor can override.
export const nonReviewableFailureCodes: string[] = [
  "NOT_ENROLLED",
  "SECTION_MISMATCH",
  "DUPLICATE_ATTENDANCE"
] as const;
