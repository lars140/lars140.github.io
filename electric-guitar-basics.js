const steps = [...document.querySelectorAll('[data-step]')];
const outlines = [...document.querySelectorAll('[data-outline]')];
const progress = document.querySelector('#lessonProgress');
const progressLabel = document.querySelector('#progressLabel');
const sectionLabel = document.querySelector('#sectionLabel');
let currentStep = 0;

// Finishing a lesson counts as a practice day for the daily streak (see api/streak.js).
function recordLessonCompleted() {
  const now = new Date(), pad = (value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  fetch('/api/streak', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) }).catch(() => {});
}

function showStep(nextStep) {
  currentStep = nextStep;
  steps.forEach((step, index) => { step.hidden = index !== nextStep; step.classList.toggle('is-visible', index === nextStep); });
  outlines.forEach((item, index) => { item.classList.toggle('is-active', index === nextStep); item.classList.toggle('is-complete', index < nextStep); });
  const percentage = Math.min(nextStep, 4) * 25;
  progress.style.width = `${percentage}%`;
  progressLabel.textContent = `${percentage}% complete`;
  sectionLabel.textContent = nextStep < 4 ? `Section ${nextStep + 1} of 4` : 'Complete';
  if (nextStep === 4) recordLessonCompleted();
  document.querySelector('.lesson-stage').scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-next]').forEach((button) => button.addEventListener('click', () => showStep(1)));
document.querySelector('#exitLesson').addEventListener('click', () => { window.location.assign('/lessons'); });

const singleNotes = [{ note: 'E', label: 'Play the low E string open' }, { note: 'E', label: 'Play it once more—slow and clean' }, { note: '✓', label: 'Nice work! Your first single notes are done.' }];
let singleIndex = 0;
document.querySelector('#singleNoteButton').addEventListener('click', () => {
  singleIndex += 1;
  const feedback = document.querySelector('#singleFeedback');
  if (singleIndex < singleNotes.length) {
    document.querySelector('#singleNote').textContent = singleNotes[singleIndex].note;
    document.querySelector('#singleTarget').textContent = singleNotes[singleIndex].label;
    feedback.textContent = singleIndex === 1 ? 'Great. One calm, clear note at a time.' : 'Pick practice complete — you’re ready to read tabs.';
    if (singleIndex === 2) document.querySelector('#singleNoteButton').innerHTML = 'Read my first tab <span>→</span>';
  } else showStep(2);
});

const tabPattern = [0, 3, 5, 3];
let tabIndex = 0;
document.querySelector('#fretboardChoices').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const selected = Number(button.dataset.fret);
  const feedback = document.querySelector('#tabFeedback');
  if (button.dataset.string !== 'E' || selected !== tabPattern[tabIndex]) { feedback.textContent = 'Almost — this pattern uses the low E string. Follow the gold number in the tab and try again.'; feedback.className = 'interaction-feedback is-error'; return; }
  document.querySelectorAll('#interactiveTab .tab-note')[tabIndex].classList.remove('is-current');
  document.querySelectorAll('#interactiveTab .tab-note')[tabIndex].classList.add('is-played');
  tabIndex += 1;
  document.querySelector('#tabScore').textContent = `${tabIndex} / 4`;
  feedback.className = 'interaction-feedback';
  if (tabIndex === tabPattern.length) { feedback.textContent = 'You read your first tab! Ready for the riff challenge.'; document.querySelector('#fretboardChoices').hidden = true; setTimeout(() => showStep(3), 1050); return; }
  document.querySelectorAll('#interactiveTab .tab-note')[tabIndex].classList.add('is-current');
  feedback.textContent = 'Correct — now play the next number.';
});

const riffPattern = [0, 3, 5, 3, 0, 10, 8];
let riffIndex = 0;
document.querySelector('#riffFretboard').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const feedback = document.querySelector('#riffFeedback');
  const selected = Number(button.dataset.fret);
  if (selected !== riffPattern[riffIndex]) { feedback.textContent = 'Not this one yet—follow the highlighted number and try again.'; feedback.className = 'interaction-feedback is-error'; return; }
  document.querySelectorAll('#riffTab span')[riffIndex].classList.add('is-played');
  riffIndex += 1;
  document.querySelector('#riffScore').textContent = `${riffIndex} / 7`;
  feedback.className = 'interaction-feedback';
  if (riffIndex === riffPattern.length) { feedback.textContent = 'You nailed the full riff!'; setTimeout(() => showStep(4), 850); return; }
  feedback.textContent = 'Yes! Keep the same steady pulse.';
});
