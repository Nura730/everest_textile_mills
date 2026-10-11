// Labels and client-side checks for the attendance register (the server computes wages and decides).

export const ATTENDANCE_LABELS = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent' };
export const ATTENDANCE_TONES = { PRESENT: 'success', HALF_DAY: 'warning', ABSENT: 'neutral' };
export const WAGE_BASIS_LABELS = { DAILY: 'Daily rate', HOURLY: 'Hourly rate' };
export const DEPARTMENTS = ['SPINNING', 'WEAVING', 'DYEING', 'FINISHING', 'STORE', 'QUALITY', 'MAINTENANCE', 'GENERAL'];
export const DEPARTMENT_LABELS = {
  SPINNING: 'Spinning', WEAVING: 'Weaving', DYEING: 'Dyeing', FINISHING: 'Finishing',
  STORE: 'Store', QUALITY: 'Quality', MAINTENANCE: 'Maintenance', GENERAL: 'General',
};
// Mirrors FLOOR_CORRECTION_WINDOW_DAYS on the server.
export const FLOOR_CORRECTION_WINDOW_DAYS = 7;

/**
 * The request body for one register row, or an error message. Hours only for hourly-rated workers who
 * worked; daily-rated workers are paid per day (present / half day).
 */
export function attendanceEntry({ worker, date, status, hours }) {
  if (!status) return { error: 'Choose present, half day or absent.' };
  const body = { workerId: worker.id, date, status };
  if (worker.wageBasis === 'HOURLY' && status !== 'ABSENT') {
    const text = String(hours ?? '').trim();
    const value = Number(text);
    if (!text || !(value > 0) || value > 24 || !/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter the hours worked (above 0, up to 24, at most 2 decimals).' };
    body.hours = value;
  }
  return { body };
}

/** "YYYY-MM-DD" n days before `date` (calendar arithmetic, no time zone). */
export function daysBefore(date, n) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Whether this role may correct an entry of `entryDate` (floor: the last 7 days; admin: any). */
export function canCorrect(role, entryDate, today) {
  if (role === 'ADMIN') return true;
  if (role !== 'FLOOR_MANAGER') return false;
  return entryDate >= daysBefore(today, FLOOR_CORRECTION_WINDOW_DAYS - 1);
}

/** Today's date in India ("YYYY-MM-DD"). */
export function todayInIndia(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
