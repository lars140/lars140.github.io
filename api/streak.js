// Streak backend. Called by server.js after it has verified the session, so userId can be trusted.
const path = require('node:path');
const { withDatabase } = require('./store');

const dataFile = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'streaks.json');
const day = 24 * 60 * 60 * 1000;

const reply = (status, body) => ({ status, body });
const key = (time) => new Date(time).toISOString().slice(0, 10);

// Returns the UTC time of a YYYY-MM-DD string, or null when it is not a real date.
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || key(time) !== value ? null : time;
}

function longestRun(days) {
  let best = 0, run = 0, previous = null;
  for (const value of days) {
    const current = parseDate(value);
    run = previous !== null && previous + day === current ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  return best;
}

function summary(days, today) {
  const set = new Set(days);
  const doneToday = set.has(key(today));
  // The streak stays alive until the end of today even if today's lesson is still ahead.
  let cursor = doneToday ? today : today - day;
  let current = 0;
  while (set.has(key(cursor))) { current++; cursor -= day; }

  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * day;
  const week = Array.from({ length: 7 }, (_, i) => {
    const time = monday + i * day;
    return { date: key(time), done: set.has(key(time)), today: time === today };
  });
  return { current, best: Math.max(longestRun(days), current), doneToday, week };
}

async function handle({ userId, action, date }) {
  const today = typeof date === 'string' ? parseDate(date) : null;
  if (typeof userId !== 'string' || !userId || today === null) return reply(400, { code: 'INVALID_INPUT', message: 'A valid date is required.' });

  // Clients may be in any timezone, so allow one day of drift from the server's UTC date, but no more.
  if (Math.abs(today - parseDate(key(Date.now()))) > day) return reply(400, { code: 'INVALID_DATE', message: 'Date is out of range.' });

  if (action === 'get') {
    const days = await withDatabase(dataFile, (db) => db.users[userId]?.days ?? []);
    return reply(200, summary(days, today));
  }
  if (action === 'complete') {
    const days = await withDatabase(dataFile, (db, save) => {
      const days = db.users[userId]?.days ?? [];
      if (!days.includes(key(today))) {
        days.push(key(today));
        days.sort();
        db.users[userId] = { days };
        save.value = true;
      }
      return days;
    });
    return reply(200, summary(days, today));
  }
  return reply(400, { code: 'INVALID_ACTION', message: 'Unknown action.' });
}

module.exports = { handle };
