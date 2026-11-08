// The colour you write in. Every window that shows your messages reads it here.
const KEY = 'myColor';
const BLACK = '#000000';

export function readMyColor() {
  try {
    return localStorage.getItem(KEY) || BLACK;
  } catch {
    return BLACK;
  }
}

export function saveMyColor(color) {
  try {
    localStorage.setItem(KEY, color);
  } catch {
    // keep it for this window only
  }
}
