// Workers, attendance and wages (labour register). Money in integer paise, hours in integer minutes.

export const WAGE_BASIS = Object.freeze({ DAILY: 'DAILY', HOURLY: 'HOURLY' });

export const ATTENDANCE_STATUS = Object.freeze({ PRESENT: 'PRESENT', HALF_DAY: 'HALF_DAY', ABSENT: 'ABSENT' });

// Where a worker works; used to group the register and the wage summary.
export const DEPARTMENTS = Object.freeze(['SPINNING', 'WEAVING', 'DYEING', 'FINISHING', 'STORE', 'QUALITY', 'MAINTENANCE', 'GENERAL']);

// A floor manager may correct attendance of the last 7 days (today included); older days only the admin.
export const FLOOR_CORRECTION_WINDOW_DAYS = 7;

// Longest shift that can be entered for a day (in minutes).
export const MAX_MINUTES_PER_DAY = 24 * 60;
