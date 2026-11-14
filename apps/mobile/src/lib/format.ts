// Small text helpers shared by both roles. Wording follows design-system/components/bundle.js.

/** "just now", "3 min ago", "1 h 5 min ago". Empty when there is no age. */
export function ageText(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${rest ? `${rest} min ` : ''}ago`;
}

/** Clock time in 24-hour form in the device's zone: "14:02". */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A 0 to 1 share as a whole percentage: "83%". */
export function percent(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

/** A vital sign as it is printed: whole numbers, no trailing ".0". */
export function wholeNumber(value: number): string {
  return String(Math.round(value));
}

/**
 * Applies the copy rule for full stops: one sentence alone has none, two or more keep them.
 * Server messages and local ones meet in the same string, so it is settled here.
 */
export function tidy(text: string): string {
  const trimmed = text.trim();
  const several = /[.?!]\s+\S/.test(trimmed);
  if (several) return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return trimmed.replace(/\.$/, '');
}

/** Joins sentences into one string, with a full stop after each when there is more than one. */
export function sentences(...parts: (string | null | undefined)[]): string {
  const present = parts.map((part) => part?.trim() ?? '').filter((part) => part !== '');
  return tidy(present.map((part) => (/[.?!]$/.test(part) ? part : `${part}.`)).join(' '));
}
