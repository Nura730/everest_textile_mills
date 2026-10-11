import { ATTENDANCE_STATUS, MAX_MINUTES_PER_DAY, WAGE_BASIS } from '../constants/workforce.js';
import { AppError } from '../utils/AppError.js';

/*
 * Wage of one attendance entry, computed by the server only (never taken from the client). Pure.
 *
 *   DAILY  PRESENT   rate (paise per day)
 *          HALF_DAY  rate × half-day factor (HALF_DAY_WAGE_FACTOR_BP, 5000 = 50% by default), rounded to the paisa
 *          ABSENT    0
 *          (no hours: a daily-rated worker is paid per day)
 *   HOURLY PRESENT / HALF_DAY  hours worked × rate (paise per hour), rounded to the paisa; hours required (> 0)
 *          ABSENT    0 (no hours)
 */
export function computeWage({ wageBasis, ratePaise, status, minutes, halfDayFactorBp }) {
  const invalid = (message) => new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path: 'hours', message }] });
  if (status === ATTENDANCE_STATUS.ABSENT) {
    if (minutes) throw invalid('must be empty when the worker is absent');
    return { minutes: null, wagePaise: 0 };
  }
  if (wageBasis === WAGE_BASIS.DAILY) {
    if (minutes) throw invalid('must be empty for a daily-rated worker (paid per day: present or half day)');
    const wagePaise = status === ATTENDANCE_STATUS.HALF_DAY ? Math.round((ratePaise * halfDayFactorBp) / 10_000) : ratePaise;
    return { minutes: null, wagePaise };
  }
  if (!minutes || minutes <= 0) throw invalid('is required for an hourly-rated worker who worked (hours above 0)');
  if (minutes > MAX_MINUTES_PER_DAY) throw invalid('cannot exceed 24 hours in a day');
  return { minutes, wagePaise: Math.round((minutes * ratePaise) / 60) };
}

/** Hours as entered ("7.5") → whole minutes. Pure. */
export const hoursToMinutes = (hours) => (hours === undefined || hours === null ? null : Math.round(hours * 60));
