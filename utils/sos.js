const ACTIVE_MS = 6 * 60 * 60 * 1000;
const EARTH_KM = 6371;

const toRad = (d) => (d * Math.PI) / 180;
const insideBangladesh = (lat, lng) => lat >= 20.5 && lat <= 26.7 && lng >= 88 && lng <= 92.8;
const roundCoord = (n) => Math.round(n * 100) / 100;
const activeSince = () => new Date(Date.now() - ACTIVE_MS);

function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function boundingBox(lat, lng, km) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos(toRad(lat))));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

module.exports = { ACTIVE_MS, insideBangladesh, roundCoord, activeSince, distanceKm, boundingBox };