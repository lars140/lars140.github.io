# Stringly

This project now has a small Node.js server for account registration and login. It uses only Node's built-in modules; no package installation is needed.

1. Install Node.js 18 or newer if it is not already installed.
2. Run `node server.js` from this folder.
3. Open `http://127.0.0.1:3000` in your browser. Do not open `index.html` directly—the account endpoints need the server.

`POST /api/register` accepts JSON `{ "name": "...", "email": "...", "password": "..." }` and creates an account. `POST /api/login` accepts email, password, and optional `remember`. Both return an HTTP-only session cookie. `GET /api/me` returns the current account and `POST /api/logout` ends the session. `/dashboard` requires a valid session.

**Daily streak:** the streak logic lives in `api/streak.js` (plain Node.js, no extra install needed). `GET /api/streak?date=YYYY-MM-DD` returns the current streak, personal best and this week's days. `POST /api/streak` with `{ "date": "YYYY-MM-DD" }` marks that day as practiced; the lesson pages call it when a lesson is finished. Days are stored per account in `data/streaks.json`.

## Putting it online

GitHub Pages cannot run `server.js`, so sign-up, login, streaks and songs will not work there. Host the whole app on a service that runs Node.js, for example [Render](https://render.com):

1. Push this repo to GitHub, then in Render choose **New > Blueprint** and select it. `render.yaml` sets everything up.
2. Open the `onrender.com` URL Render gives you (not the GitHub Pages one).

Environment variables: `PORT` (set by the host; the server then listens on all addresses), `HOST`, `NODE_ENV=production` (secure cookies), `TRUST_PROXY=1` (use the client address from the host's proxy for rate limiting) and `DATA_DIR` (where the JSON files are stored; point it at a persistent disk, otherwise accounts are lost on every deploy).

Passwords are stored as salted scrypt hashes in `data/accounts.json`, never as plain text. The `data/` directory is ignored by Git and is not served publicly. Back it up securely if you need to preserve accounts. For deployment beyond local development, use HTTPS, durable database storage, email verification, and operational monitoring. Set `NODE_ENV=production` or `COOKIE_SECURE=1` when serving over HTTPS so session cookies use the `Secure` flag.
