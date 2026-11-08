// A QR code, as an SVG: what Settings > Remote access shows to pair a phone with. Drawn by Project Nayuki's
// generator (vendor/qrcodegen.js), dark on white whatever the theme, with the quiet border cameras look for.
import { qrcodegen } from './vendor/qrcodegen.js';

/** The QR code's squares for `text`, each row a string of '1' for dark and '0' for light. */
export function qrRows(text) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  return Array.from({ length: qr.size }, (_, y) =>
    Array.from({ length: qr.size }, (_, x) => (qr.getModule(x, y) ? '1' : '0')).join('')
  );
}

/**
 * @param {string} text
 * @param {{ border?: number, label?: string }} [options]  `border`: the light squares around it, 4 as the standard has
 */
export function qrSvg(text, { border = 4, label = 'QR code' } = {}) {
  const rows = qrRows(text);
  const size = rows.length + border * 2;
  const dark = rows.flatMap((row, y) =>
    [...row].flatMap((module, x) => (module === '1' ? [`M${x + border} ${y + border}h1v1h-1z`] : []))
  );
  const name = label.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${name}"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${dark.join('')}"/></svg>`;
}
