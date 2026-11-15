'use strict';
// Frost dates from a US ZIP code.
//  1. ZIP -> place + coordinates (zippopotam.us), hardiness zone (phzmapi.org)
//  2. 30 years of daily minimum temperatures at those coordinates (Open-Meteo historical archive)
//  3. Median date of the last spring and first fall freeze (<= 32°F / 0°C) — the same
//     50%-probability definition NOAA uses for its published frost dates.
// Results are cached in SQLite, so each ZIP is only looked up once.

const YEARS = 30;
const TIMEOUT = 25000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'garden-planner (self-hosted)' } });
  if (!res.ok) { const e = new Error(`HTTP ${res.status} from ${new URL(url).host}`); e.status = res.status; throw e; }
  return res.json();
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// day-of-year on a 365-day calendar (Feb 29 folds onto Feb 28) so years line up
function doy(y, m, d) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[m - 1] + Math.min(d, m === 2 ? 28 : 31);
}
function doyToMD(n) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 0; n = Math.round(n);
  while (m < 11 && n > days[m]) { n -= days[m]; m++; }
  return `${String(m + 1).padStart(2, '0')}-${String(Math.max(1, n)).padStart(2, '0')}`;
}
function median(a) { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

/**
 * @param {string[]} dates  'YYYY-MM-DD'
 * @param {number[]} tmin   °C (null allowed)
 */
function computeFrost(dates, tmin) {
  const MID = doy(2001, 7, 15); // split the year in mid-July
  const years = new Map();
  dates.forEach((ds, i) => {
    const t = tmin[i];
    if (t == null) return;
    const [y, m, d] = ds.split('-').map(Number);
    if (!years.has(y)) years.set(y, { last: null, first: null, days: 0 });
    const e = years.get(y); e.days++;
    if (t > 0) return;
    const n = doy(y, m, d);
    if (n <= MID) e.last = n; // keeps the latest spring freeze
    else if (e.first == null) e.first = n; // first fall freeze
  });
  const full = [...years.entries()].filter(([, e]) => e.days >= 330);
  if (!full.length) return null;
  const springs = full.map(([, e]) => e.last).filter((x) => x != null);
  const falls = full.map(([, e]) => e.first).filter((x) => x != null);
  const half = full.length / 2;
  return {
    years: full.length,
    lastFrost: springs.length >= half ? doyToMD(median(springs)) : null,
    firstFrost: falls.length >= half ? doyToMD(median(falls)) : null,
    frostFreeDays: springs.length >= half && falls.length >= half ? Math.round(median(falls) - median(springs)) : null,
  };
}

async function lookupZip(zip) {
  const [place, zone] = await Promise.allSettled([
    getJson(`https://api.zippopotam.us/us/${zip}`),
    getJson(`https://phzmapi.org/${zip}.json`),
  ]);
  if (place.status === 'rejected' && place.reason?.status === 404) { const e = new Error('That ZIP code was not found'); e.status = 404; throw e; }
  let lat, lon, name = null;
  if (place.status === 'fulfilled' && place.value.places?.length) {
    const p = place.value.places[0];
    lat = Number(p.latitude); lon = Number(p.longitude);
    name = `${p['place name']}, ${p['state abbreviation']}`;
  }
  const z = zone.status === 'fulfilled' ? zone.value : null;
  if ((lat == null || Number.isNaN(lat)) && z?.coordinates) { lat = Number(z.coordinates.lat); lon = Number(z.coordinates.lon); }
  if (lat == null || Number.isNaN(lat)) {
    const notFound = place.status === 'rejected' && place.reason?.status === 404;
    const e = new Error(notFound ? 'That ZIP code was not found' : 'Could not reach the ZIP code lookup service. Check the server has internet access.');
    e.status = notFound ? 404 : 502; throw e;
  }
  const endYear = new Date().getFullYear() - 1;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&start_date=${endYear - YEARS + 1}-01-01&end_date=${endYear}-12-31&daily=temperature_2m_min&timezone=auto`;
  let weather;
  try { weather = await getJson(url); } catch (err) {
    const e = new Error('Could not reach the weather history service. Try again in a minute.'); e.status = 502; throw e;
  }
  const f = computeFrost(weather.daily?.time || [], weather.daily?.temperature_2m_min || []);
  if (!f) { const e = new Error('No weather history for that location'); e.status = 502; throw e; }
  return { zip, place: name, zone: z?.zone || null, lat, lon, ...f, source: `Median of ${f.years} years of daily lows (Open-Meteo), 32°F threshold` };
}

module.exports = { lookupZip, computeFrost, doyToMD };
