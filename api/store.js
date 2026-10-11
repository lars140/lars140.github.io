// Tiny JSON file store shared by the streak and song backends.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const queues = new Map();

async function read(file) {
  try {
    const db = JSON.parse(await fs.readFile(file, 'utf8'));
    if (db && db.users && typeof db.users === 'object' && !Array.isArray(db.users)) return db;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { users: {} };
}

// Runs callback(db, save) one at a time per file; the database is saved when callback sets `save.value = true`.
function withDatabase(file, callback) {
  const run = (queues.get(file) || Promise.resolve()).then(async () => {
    const db = await read(file);
    const save = { value: false };
    const result = await callback(db, save);
    if (save.value) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporaryFile = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporaryFile, JSON.stringify(db), { mode: 0o600 });
        await fs.rename(temporaryFile, file);
      } catch (error) {
        await fs.unlink(temporaryFile).catch(() => {});
        throw error;
      }
    }
    return result;
  });
  queues.set(file, run.catch(() => {}));
  return run;
}

module.exports = { withDatabase };
