export const W = 1440;
export const H = 900;
export const LIMIT = 85;
export const RAD = Math.PI / 180;
// A village street is nine hundred metres on a world six thousand kilometres
// across, and a mill on it is eighteen. Coming close enough for a building to be
// the thing you are looking at is six figures of zoom, not two.
export const CLOSEST = 250000;

/** Mercator stretches toward the poles without bound, so it is cut at 85°. */
const TALL = Math.log(Math.tan((45 + LIMIT / 2) * RAD));

export function down(lat) {
  const held = Math.max(-LIMIT, Math.min(LIMIT, lat));
  return ((1 - Math.log(Math.tan((45 + held / 2) * RAD)) / TALL) / 2) * H;
}

/** Longitude to the left edge. Wrapped, so anything written outside ±180 lands. */
export const wrapped = (lon) => (lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180);
export const across = (lon) => ((wrapped(lon) + 180) / 360) * W;

export const hold = (n, low, high) => Math.max(low, Math.min(high, n));

export const nice = (most) => {
  const ten = 10 ** Math.floor(Math.log10(most));
  return [5, 2, 1].map((n) => n * ten).find((n) => n <= most) ?? ten;
};

export const metresPerPixel = (radius, lat, k) => (2 * Math.PI * radius * Math.cos(lat * RAD)) / (W * k);

// The projection read backwards. Looking at a map never needs this; putting a
// finger on one and saying "there" does.
export const lonOf = (x) => (x / W) * 360 - 180;
export const latOf = (y) => 2 * (Math.atan(Math.exp(TALL * (1 - (2 * y) / H))) / RAD - 45);

export const onMap = ([lon, lat]) => [across(lon), down(lat)];
export const offMap = ([x, y]) => [lonOf(x), latOf(y)];
export const project = (run) => run.map(onMap);
export const offset = (points, o) => points.map(([x, y]) => [x - o.x, y - o.y]);
export const local = ([lon, lat], o) => [across(lon) - o.x, down(lat) - o.y];

export function boxOf(points) {
  if (!points.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

export const pathOf = (points, shut = false) =>
  points.length ? "M " + points.map(([x, y]) => `${x} ${y}`).join(" L ") + (shut ? " Z" : "") : "";

export function lengths(points) {
  const upto = [0];
  for (let n = 1; n < points.length; n++) {
    upto.push(upto[n - 1] + Math.hypot(points[n][0] - points[n - 1][0], points[n][1] - points[n - 1][1]));
  }
  return upto;
}

/**
 * The day/night line: for every meridian, the latitude at which the primary sits
 * exactly on the horizon. It is one curve because a sphere lit from one side has
 * one, and the dark half is whichever pole is leaning away.
 */
export function night(subsolar, o) {
  const tilt = Math.tan(subsolar.lat * RAD) || 1e-9;
  const edge = [];
  for (let lon = -180; lon <= 180; lon += 1) {
    const hour = (lon - subsolar.lon) * RAD;
    const lat = Math.atan(-Math.cos(hour) / tilt) / RAD;
    edge.push(local([lon, lat], o));
  }
  // The dark half is closed off along whichever edge of the picture is the pole
  // leaning away from the primary. No line is drawn along the curve itself: the sun
  // does not set at an edge, and an edge is what a stroke would draw.
  const pole = (subsolar.lat >= 0 ? H : 0) - o.y;
  const drawn = edge.map(([x, y]) => [x.toFixed(1), y.toFixed(1)]);
  return pathOf([...drawn, [W - o.x, pole], [-o.x, pole]], true);
}
