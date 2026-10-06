// Song lesson page: shows one song, saves practice-step progress, and records the practice day when a song is learned.
const slug = location.pathname.split('/').pop();
const $ = (selector) => document.querySelector(selector);
const sidebar = $('#sidebar'), menuButton = $('#menuButton'), scrim = $('#sidebarScrim');
menuButton.addEventListener('click', () => { const open = sidebar.classList.toggle('is-open'); menuButton.setAttribute('aria-expanded', open); scrim.hidden = !open; });
scrim.addEventListener('click', () => { sidebar.classList.remove('is-open'); menuButton.setAttribute('aria-expanded', 'false'); scrim.hidden = true; });
$('#logoutButton').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); window.location.assign('/'); });
fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : Promise.reject()).then(({ user }) => $('#userAvatar').textContent = user.name.charAt(0).toUpperCase()).catch(() => window.location.assign('/'));

let song = null;

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function recordPracticeDay() {
  fetch('/api/streak', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: localDate() }) }).catch(() => {});
}

function showError(message) { const box = $('#songError'); box.textContent = message; box.hidden = !message; }

function renderVideo() {
  const frame = $('#videoFrame'), note = $('#videoNote');
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist} guitar lesson`)}`;
  if (song.video) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(song.video)}`;
    iframe.title = `${song.title} guitar tutorial`;
    iframe.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.replaceChildren(iframe);
    note.replaceChildren('Video not playing? ', Object.assign(document.createElement('a'), { href: `https://www.youtube.com/watch?v=${encodeURIComponent(song.video)}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'Watch on YouTube' }), ' or ', Object.assign(document.createElement('a'), { href: search, target: '_blank', rel: 'noopener noreferrer', textContent: 'find another tutorial' }), '.');
  } else {
    frame.hidden = true;
    note.replaceChildren(Object.assign(document.createElement('a'), { href: search, target: '_blank', rel: 'noopener noreferrer', textContent: 'Find a tutorial on YouTube' }));
  }
}

function renderProgress() {
  const done = song.completedSteps.length, total = song.steps.length;
  $('#stepBar').style.width = `${done / total * 100}%`;
  $('#stepCount').textContent = song.done ? 'All steps complete. Nice work!' : `${done} of ${total} steps complete`;
  document.querySelectorAll('#stepList input').forEach((box, index) => { box.checked = song.completedSteps.includes(index); });
  const button = $('#doneButton');
  button.textContent = song.done ? '✓ Learned (tap to undo)' : 'Mark song as learned';
  button.classList.toggle('is-done', song.done);
}

function renderSong() {
  document.title = `${song.title} | Stringly`;
  $('#songTitle').textContent = song.title;
  $('#songArtist').textContent = song.artist;
  $('#songDescription').textContent = song.description;
  $('#songTuning').textContent = song.tuning;
  const dots = document.createElement('span');
  dots.className = 'difficulty__dots';
  for (let i = 1; i <= 10; i++) dots.append(Object.assign(document.createElement('i'), { className: i <= song.difficulty ? 'is-on' : '' }));
  $('#songDifficulty').replaceChildren('Difficulty ', dots, ` ${song.difficulty}/10`);
  $('#stepList').replaceChildren(...song.steps.map((text, index) => {
    const label = document.createElement('label'), box = document.createElement('input'), span = document.createElement('span');
    box.type = 'checkbox';
    box.addEventListener('change', () => save({ step: index, checked: box.checked }));
    span.textContent = text;
    label.append(box, span);
    const item = document.createElement('li');
    item.append(label);
    return item;
  }));
  renderVideo();
  renderProgress();
}

async function save(body) {
  showError('');
  const wasDone = song.done;
  const button = $('#doneButton');
  button.disabled = true;
  try {
    const response = await fetch(`/api/songs/${slug}/progress`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error();
    song = { ...song, ...(await response.json()).song };
    if (song.done && !wasDone) recordPracticeDay();
  } catch {
    showError('Your progress could not be saved. Please try again.');
  } finally {
    button.disabled = false;
    renderProgress();
  }
}

$('#doneButton').addEventListener('click', () => save({ done: !song.done }));

fetch(`/api/songs/${slug}`, { credentials: 'same-origin' })
  .then((r) => r.ok ? r.json() : Promise.reject(r.status))
  .then((data) => {
    song = data.song;
    renderSong();
    for (const [id, neighbour, arrow] of [['#prevSong', data.previous, '← '], ['#nextSong', data.next, '']]) {
      const link = $(id);
      if (!neighbour) continue;
      link.href = `/songs/${neighbour.slug}`;
      link.textContent = id === '#prevSong' ? `${arrow}${neighbour.title}` : `${neighbour.title} →`;
      link.hidden = false;
    }
    $('#songRank').textContent = 'Song lesson';
    $('#songDetail').hidden = false;
  })
  .catch((status) => {
    if (status === 401) return window.location.assign('/');
    $('#pageError').hidden = false;
  });
