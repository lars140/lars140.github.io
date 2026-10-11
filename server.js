// Run with Node.js 18 or newer: node server.js
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const streakApi = require('./api/streak');
const songsApi = require('./api/songs');

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataFile = path.join(root, 'data', 'accounts.json');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const secureCookie = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
const sessionAge = 7 * 24 * 60 * 60 * 1000;
const rememberedSessionAge = 30 * 24 * 60 * 60 * 1000;
const attempts = new Map();
let pendingWrite = Promise.resolve();

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(value));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { code, message });
}

async function readDatabase() {
  try {
    return JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { users: [], sessions: [] };
    throw error;
  }
}

async function saveDatabase(db) {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(db), { mode: 0o600 });
    await fs.rename(temporaryFile, dataFile);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

function changeDatabase(callback) {
  const next = pendingWrite.then(async () => {
    const db = await readDatabase();
    db.sessions = db.sessions.filter((session) => session.expiresAt > Date.now());
    const result = await callback(db);
    if (result.save) await saveDatabase(db);
    return result;
  });
  pendingWrite = next.catch(() => {});
  return next;
}

function sessionCookie(token, lifetime) {
  const parts = [`stringly_session=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(lifetime / 1000)}`];
  if (secureCookie) parts.push('Secure');
  return parts.join('; ');
}

function createSession(db, userId, remember = false) {
  const token = crypto.randomBytes(32).toString('hex');
  const lifetime = remember ? rememberedSessionAge : sessionAge;
  db.sessions.push({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt: Date.now() + lifetime });
  return { token, lifetime };
}

async function currentUser(req) {
  const token = /(?:^|;\s*)stringly_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const db = await readDatabase();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  return session ? db.users.find((user) => user.id === session.userId) || null : null;
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send JSON data.' };
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16_384) throw { status: 413, code: 'TOO_LARGE', message: 'Request is too large.' };
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON object');
    return data;
  }
  catch { throw { status: 400, code: 'INVALID_JSON', message: 'Invalid request data.' }; }
}

function checkOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}

function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  else entry.count += 1;
  if (attempts.size > 1000) for (const [address, value] of attempts) if (value.resetAt <= now) attempts.delete(address);
  return attempts.get(key).count > 20;
}

async function register(req, res) {
  const data = await readJson(req);
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = data.password;
  if (!name || name.length > 80) return sendError(res, 400, 'INVALID_NAME', 'Enter a name of up to 80 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return sendError(res, 400, 'INVALID_PASSWORD', 'Use a password between 8 and 128 characters.');

  const result = await changeDatabase(async (db) => {
    if (db.users.some((user) => user.email === email)) return { save: false, duplicate: true };
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const user = { id: crypto.randomUUID(), name, email, salt, passwordHash, createdAt: new Date().toISOString() };
    db.users.push(user);
    const session = createSession(db, user.id);
    return { save: true, session, user };
  });
  if (result.duplicate) return sendError(res, 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  sendJson(res, 201, { user: { id: result.user.id, name: result.user.name, email: result.user.email } }, { 'Set-Cookie': sessionCookie(result.session.token, result.session.lifetime) });
}

async function login(req, res) {
  const data = await readJson(req);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = data.password;
  if (!email || typeof password !== 'string' || password.length > 128) return sendError(res, 400, 'INVALID_INPUT', 'Enter your email and password.');
  const db = await readDatabase();
  const user = db.users.find((item) => item.email === email);
  if (!user) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  const actualHash = await scrypt(password, user.salt, 64);
  if (!crypto.timingSafeEqual(actualHash, Buffer.from(user.passwordHash, 'hex'))) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  const result = await changeDatabase(async (latest) => ({ save: true, session: createSession(latest, user.id, data.remember === true) }));
  sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email } }, { 'Set-Cookie': sessionCookie(result.session.token, result.session.lifetime) });
}

async function requestPasswordReset(req, res) {
  const data = await readJson(req);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');

  // Email delivery is intentionally not implemented in this local-only project.
  // The identical response prevents account enumeration when it is later connected.
  sendJson(res, 202, { message: 'If an account exists for that email, you will receive password reset instructions.' });
}

async function songs(res, user, payload) {
  try {
    const { status, body } = await songsApi.handle({ userId: user.id, ...payload });
    sendJson(res, status, body);
  } catch (error) {
    console.error('Songs backend failed:', error);
    sendError(res, 503, 'SONGS_UNAVAILABLE', 'Songs are unavailable right now.');
  }
}

async function streak(req, res, user, action, date) {
  if (typeof date !== 'string') return sendError(res, 400, 'INVALID_DATE', 'A valid date is required.');
  try {
    const { status, body } = await streakApi.handle({ userId: user.id, action, date });
    sendJson(res, status, body);
  } catch (error) {
    console.error('Streak backend failed:', error);
    sendError(res, 503, 'STREAK_UNAVAILABLE', 'Streak tracking is unavailable right now.');
  }
}

async function serveFile(res, filename, type) {
  try {
    const contents = await fs.readFile(path.join(root, filename));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': filename.endsWith('.png') ? 'public, max-age=3600' : 'no-store' });
    res.end(contents);
  } catch (error) {
    if (error.code === 'ENOENT') return sendError(res, 404, 'NOT_FOUND', 'Page not found.');
    throw error;
  }
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8'],
  '/electric-guitar-basics.js': ['electric-guitar-basics.js', 'text/javascript; charset=utf-8'],
  '/song-lesson.js': ['song-lesson.js', 'text/javascript; charset=utf-8'],
  '/song-lesson.css': ['song-lesson.css', 'text/css; charset=utf-8'],
  '/song-youtube.css': ['song-youtube.css', 'text/css; charset=utf-8'],
  '/songs.css': ['songs.css', 'text/css; charset=utf-8'],
  '/songs.js': ['songs.js', 'text/javascript; charset=utf-8'],
  '/song-detail.js': ['song-detail.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/hero-electric-guitar.png': ['hero-electric-guitar.png', 'image/png'],
  '/forgot-password': ['forgot-password.html', 'text/html; charset=utf-8'],
  '/terms': ['terms.html', 'text/html; charset=utf-8'],
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && staticFiles[url.pathname]) return await serveFile(res, ...staticFiles[url.pathname]);
    if (req.method === 'GET' && url.pathname === '/dashboard') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'dashboard.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/practice') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'practice.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/lessons') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'lessons.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/songs') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'songs.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/songs/hey-brother') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'hey-brother.html', 'text/html; charset=utf-8');
    }
    const songPage = /^\/songs\/([a-z0-9-]{1,60})$/.exec(url.pathname);
    if (req.method === 'GET' && songPage) {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'song-detail.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/lessons/electric-guitar-basics') {
      if (!await currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return await serveFile(res, 'electric-guitar-basics.html', 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = await currentUser(req);
      return user ? sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email } }) : sendError(res, 401, 'UNAUTHORIZED', 'Please log in.');
    }
    if (url.pathname === '/api/streak') {
      const user = await currentUser(req);
      if (!user) return sendError(res, 401, 'UNAUTHORIZED', 'Please log in.');
      if (req.method === 'GET') return await streak(req, res, user, 'get', url.searchParams.get('date'));
      if (req.method === 'POST') {
        if (!checkOrigin(req)) return sendError(res, 403, 'BAD_ORIGIN', 'Request origin is not allowed.');
        const data = await readJson(req);
        return await streak(req, res, user, 'complete', data.date);
      }
    }
    const songApi = /^\/api\/songs(?:\/([a-z0-9-]{1,60})(\/progress)?)?$/.exec(url.pathname);
    if (songApi) {
      const user = await currentUser(req);
      if (!user) return sendError(res, 401, 'UNAUTHORIZED', 'Please log in.');
      const [, slug, progress] = songApi;
      if (req.method === 'GET' && !progress) return await songs(res, user, slug ? { action: 'get', slug } : { action: 'list' });
      if (req.method === 'POST' && slug && progress) {
        if (!checkOrigin(req)) return sendError(res, 403, 'BAD_ORIGIN', 'Request origin is not allowed.');
        const data = await readJson(req);
        return await songs(res, user, data.step === undefined ? { action: 'complete', slug, done: data.done } : { action: 'step', slug, step: data.step, checked: data.checked });
      }
    }
    if (req.method === 'POST' && ['/api/register', '/api/login', '/api/logout', '/api/password-reset'].includes(url.pathname)) {
      if (!checkOrigin(req)) return sendError(res, 403, 'BAD_ORIGIN', 'Request origin is not allowed.');
      if (url.pathname !== '/api/logout' && rateLimited(req)) return sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
      if (url.pathname === '/api/register') return await register(req, res);
      if (url.pathname === '/api/login') return await login(req, res);
      if (url.pathname === '/api/password-reset') return await requestPasswordReset(req, res);
      const token = /(?:^|;\s*)stringly_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (token) await changeDatabase(async (db) => {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
        return { save: true };
      });
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    sendError(res, 404, 'NOT_FOUND', 'Page not found.');
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.code, error.message);
    console.error('Server request failed:', error);
    sendError(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
  }
});

server.listen(port, host, () => console.log(`Stringly is running at http://${host}:${port}`));
