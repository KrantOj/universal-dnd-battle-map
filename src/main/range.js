'use strict';
// Pure helpers for HTTP Range support of userfile:// (unit-tested in tests/range.test.js).

const MIME = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  json: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', pdf: 'application/pdf',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function mimeOf(file) {
  const m = /\.([^.\/]+)$/.exec(String(file || ''));
  return (m && MIME[m[1].toLowerCase()]) || 'application/octet-stream';
}

/** Range header -> {start, end} (inclusive) | null (no/ignored header: send the whole file) | 'invalid' (answer 416). Only the first range is honoured. */
function parseRange(header, size) {
  if (header === undefined || header === null || header === '') return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(String(header));
  if (!m || (m[1] === '' && m[2] === '')) return null;
  size = Number(size) || 0;
  let start, end;
  if (m[1] === '') {                       // suffix: последние N байт
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'invalid';
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) return 'invalid';
  }
  return { start, end };
}

module.exports = { parseRange, mimeOf };
