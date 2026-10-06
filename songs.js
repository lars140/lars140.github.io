// Song list page: loads the catalogue and the user's progress, then renders cards and filters.
const sidebar = document.querySelector('#sidebar'), menuButton = document.querySelector('#menuButton'), scrim = document.querySelector('#sidebarScrim');
menuButton.addEventListener('click', () => { const open = sidebar.classList.toggle('is-open'); menuButton.setAttribute('aria-expanded', open); scrim.hidden = !open; });
scrim.addEventListener('click', () => { sidebar.classList.remove('is-open'); menuButton.setAttribute('aria-expanded', 'false'); scrim.hidden = true; });
document.querySelector('#logoutButton').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); window.location.assign('/'); });
fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : Promise.reject()).then(({ user }) => document.querySelector('#userAvatar').textContent = user.name.charAt(0).toUpperCase()).catch(() => window.location.assign('/'));

const filters = [['All', 1, 10], ['Easiest (1-2)', 1, 2], ['Easy (3-4)', 3, 4], ['Medium (5-6)', 5, 6]];
const list = document.querySelector('#songList'), filterBar = document.querySelector('#songFilter');
const searchInput = document.querySelector('#songSearch');
let songs = [], selected = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function difficultyDots(level) {
  const wrap = el('span', 'difficulty__dots');
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 10; i++) wrap.append(el('i', i <= level ? 'is-on' : ''));
  return wrap;
}

function render() {
  const [, min, max] = filters[selected];
  const query = searchInput.value.trim().toLowerCase();
  const visible = songs.filter((s) => s.difficulty >= min && s.difficulty <= max && (!query || `${s.title} ${s.artist}`.toLowerCase().includes(query)));
  document.querySelector('#songsEmpty').hidden = visible.length > 0 || !songs.length;
  list.replaceChildren(...visible.map((song) => {
    const item = el('li', `song-item${song.done ? ' is-done' : ''}`);
    const link = el('a');
    link.href = `/songs/${song.slug}`;
    const top = el('div', 'song-item__top');
    const level = el('span', 'difficulty');
    level.append(difficultyDots(song.difficulty), `${song.difficulty}/10`);
    top.append(el('span', '', `#${songs.indexOf(song) + 1}`), level);
    const meta = el('div', 'song-item__meta');
    meta.append(el('span', 'tag', song.tuning.startsWith('Standard') ? 'Standard tuning' : 'Half step down'));
    const done = song.completedSteps.length;
    meta.append(song.done ? el('span', 'tag tag--done', '✓ Learned') : el('span', 'tag', `${done}/${song.steps.length} steps`));
    link.append(top, el('h3', '', song.title), el('p', '', song.artist), meta);
    item.append(link);
    return item;
  }));
}

searchInput.addEventListener('input', render);

filters.forEach(([label], index) => {
  const button = el('button', index === 0 ? 'is-selected' : '', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    filterBar.querySelector('.is-selected').classList.remove('is-selected');
    button.classList.add('is-selected');
    selected = index;
    render();
  });
  filterBar.append(button);
});

fetch('/api/songs', { credentials: 'same-origin' })
  .then((r) => r.ok ? r.json() : Promise.reject(r.status))
  .then((data) => {
    songs = data.songs;
    document.querySelector('#overallBar').style.width = `${data.doneCount / songs.length * 100}%`;
    document.querySelector('#overallText').textContent = `${data.doneCount} of ${songs.length} songs learned`;
    render();
  })
  .catch((status) => {
    if (status === 401) return window.location.assign('/');
    document.querySelector('#overallText').textContent = '';
    document.querySelector('#songsError').hidden = false;
  });
