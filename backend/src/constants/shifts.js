// The mill runs three 8-hour shifts (Indian time). Output is assigned to a shift by the time the roll
// was recorded; attendance can name the shift a worker was on.
export const SHIFTS = Object.freeze([
  { key: 'MORNING', label: 'Morning', hours: '06:00–14:00', from: 6, to: 14 },
  { key: 'EVENING', label: 'Evening', hours: '14:00–22:00', from: 14, to: 22 },
  { key: 'NIGHT', label: 'Night', hours: '22:00–06:00', from: 22, to: 6 },
]);
export const SHIFT_KEYS = Object.freeze(SHIFTS.map((s) => s.key));

/** The shift an hour of the day (0-23, Indian time) belongs to. */
export function shiftOfHour(hour) {
  if (hour >= 6 && hour < 14) return 'MORNING';
  if (hour >= 14 && hour < 22) return 'EVENING';
  return 'NIGHT';
}
