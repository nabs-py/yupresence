const gregorianLocale = "en-US-u-ca-gregory";

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatGregorianDate(value: Date | string | number): string {
  return new Intl.DateTimeFormat(gregorianLocale, {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(toDate(value));
}

export function formatGregorianTime(value: Date | string | number): string {
  return new Intl.DateTimeFormat(gregorianLocale, {
    calendar: "gregory",
    hour: "numeric",
    minute: "2-digit"
  }).format(toDate(value));
}

export function formatGregorianDateTime(value: Date | string | number): string {
  return `${formatGregorianDate(value)} · ${formatGregorianTime(value)}`;
}
