// Song lessons backend. Called by server.js after it has verified the session, so userId can be trusted.
// Actions: list, get, step ({ step, checked }) and complete ({ done }).
const path = require('node:path');
const { withDatabase } = require('./store');
const catalogue = require('./songs-data.json'); // sorted from easiest to hardest; descriptions are original, no tabs

const dataFile = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'progress.json');

// Every song gets the three shared practice steps after its own first "focus" step.
const songs = catalogue.map(({ focus, ...song }) => ({
  ...song,
  steps: [
    focus,
    'Play it slowly (around 60 BPM) with a metronome until it sounds clean.',
    'Raise the tempo in small steps of 5-10 BPM, only when the last speed feels easy.',
    'Play along with the original recording from start to finish.',
  ],
}));
const bySlug = new Map(songs.map((song) => [song.slug, song]));

const reply = (status, body) => ({ status, body });
const invalid = (message) => reply(400, { code: 'INVALID_INPUT', message });

// A song is "done" once every practice step is ticked.
function present(song, steps) {
  const valid = [...new Set(steps.filter((i) => Number.isInteger(i) && i >= 0 && i < song.steps.length))].sort((a, b) => a - b);
  return { ...song, completedSteps: valid, done: valid.length === song.steps.length };
}

function neighbour(index) {
  const song = songs[index];
  return song ? { slug: song.slug, title: song.title } : null;
}

async function handle({ userId, action, slug, step, checked, done }) {
  if (typeof userId !== 'string' || !userId) return invalid('A user is required.');

  if (action === 'list') {
    const progress = await withDatabase(dataFile, (db) => db.users[userId]?.songs ?? {});
    const list = songs.map((song) => present(song, progress[song.slug]?.steps ?? []));
    return reply(200, { songs: list, doneCount: list.filter((song) => song.done).length });
  }

  const song = typeof slug === 'string' ? bySlug.get(slug) : undefined;
  if (!song) return reply(404, { code: 'NOT_FOUND', message: 'Song not found.' });
  const position = songs.indexOf(song);
  const neighbours = { previous: neighbour(position - 1), next: neighbour(position + 1) };

  if (action === 'get') {
    const steps = await withDatabase(dataFile, (db) => db.users[userId]?.songs?.[slug]?.steps ?? []);
    return reply(200, { song: present(song, steps), ...neighbours });
  }

  if (action === 'step' || action === 'complete') {
    if (action === 'step') {
      if (!Number.isInteger(step) || step < 0 || step >= song.steps.length || typeof checked !== 'boolean') return invalid('Invalid practice step.');
    } else if (typeof done !== 'boolean') {
      return invalid('Invalid request.');
    }
    const steps = await withDatabase(dataFile, (db, save) => {
      let current = db.users[userId]?.songs?.[slug]?.steps ?? [];
      if (action === 'complete') current = done ? song.steps.map((_, i) => i) : [];
      else current = checked ? [...current, step] : current.filter((i) => i !== step);
      current = [...new Set(current)].sort((a, b) => a - b);
      db.users[userId] ??= {};
      db.users[userId].songs ??= {};
      db.users[userId].songs[slug] = { steps: current, updatedAt: new Date().toISOString() };
      save.value = true;
      return current;
    });
    return reply(200, { song: present(song, steps), ...neighbours });
  }

  return reply(400, { code: 'INVALID_ACTION', message: 'Unknown action.' });
}

module.exports = { handle };
