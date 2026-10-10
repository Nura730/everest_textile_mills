// Display helpers. The backend sends money in integer paise and dates as ISO strings or
// "YYYY-MM-DD" calendar dates (deadlines); these only format them, they never do business maths.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export function formatPaise(paise) {
  if (paise === undefined || paise === null) return '—';
  return inr.format(paise / 100);
}

/**
 * "320.50" (rupees, as typed) → 32050 paise, or null when it is not a non-negative amount with at
 * most 2 decimals. Never rounds: ₹320.999 is rejected instead of silently becoming ₹321.00.
 */
export function rupeesToPaise(text) {
  const value = String(text).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [rupees, fraction = ''] = value.split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatNumber(value, unit) {
  if (value === undefined || value === null) return '—';
  return unit ? `${number.format(value)} ${unit}` : number.format(value);
}

export function formatDate(value) {
  if (!value) return '—';
  // Calendar dates ("2026-11-09") are shown as-is in Indian format, without a time-zone shift.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Today's calendar date in India (the factory's calendar, same rule as the backend). */
export function todayInIndia() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "2026-10-10" + 2 years → "2028-10-10": the same string arithmetic as the backend (utils/dates.js). */
export function addYears(dateString, years) {
  return `${Number(dateString.slice(0, 4)) + years}${dateString.slice(4)}`;
}

/** Whole days from today (India) to a "YYYY-MM-DD" deadline; negative when overdue. */
export function daysUntil(dateString) {
  const diff = Date.parse(`${dateString}T00:00:00Z`) - Date.parse(`${todayInIndia()}T00:00:00Z`);
  return Math.round(diff / 86_400_000);
}
