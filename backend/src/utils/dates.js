// The factory works on Indian calendar days. A deadline is a date ("2026-10-20"), not an instant,
// so it is compared with "today in India" rather than the server's UTC clock.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** "YYYY-MM-DD" for the current calendar day in India (UTC+05:30). */
export function todayInIndia(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-10-10" + 2 years → "2028-10-10". Plain string arithmetic: no time zone involved. */
export function addYears(dateString, years) {
  const [year, rest] = [Number(dateString.slice(0, 4)), dateString.slice(4)];
  return `${year + years}${rest}`;
}

/** A calendar date is stored as UTC midnight of that date, and returned as "YYYY-MM-DD". */
export function dateStringToDate(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function dateToDateString(date) {
  return date.toISOString().slice(0, 10);
}
