// The corner pop-up: "Claude says: …". Slides in, waits (longer while you
// hover it), slides out, then closes its window.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import '../lib/look.js';
import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { emoticonize } from '../lib/emoticons.js';
import { setPack } from '../lib/pack.js';
import { pictureHtml } from '../lib/pictures.js';

const params = new URLSearchParams(location.search);
const toast = $('#toast');

$('#picture').innerHTML = pictureHtml({ avatar: params.get('avatar') || 'default', size: 'small' });
$('#title').textContent = params.get('title') || '';
$('#message').textContent = params.get('body') || '';
// The emoticons may be pictures from the pack.
api.pack.list().then((list) => {
  setPack(list);
  emoticonize($('#message'), { safe: true });
});

let timer = 0;
let leaving = false;

function leave() {
  if (leaving) return;
  leaving = true;
  toast.classList.add('leaving');
  setTimeout(() => api.window.close(), 300);
}

const wait = (ms) => {
  clearTimeout(timer);
  timer = setTimeout(leave, ms);
};

toast.addEventListener('mouseenter', () => clearTimeout(timer));
toast.addEventListener('mouseleave', () => wait(2500));
toast.addEventListener('click', () => api.window.toastClick());
$('#close').addEventListener('click', (e) => {
  e.stopPropagation();
  leave();
});
$('#options').addEventListener('click', (e) => {
  e.stopPropagation();
  api.window.toastClick();
});
wait(6000);
