// Small geometry helpers shared by world, sim and render. Points are plain {x, y} objects.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Even–odd rule point-in-polygon test. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point to P on segment AB: { x, y, t, d2 } with t in [0, 1]. */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, t, d2: dist2(px, py, x, y) };
}

/** Shortest distance from P to a polyline. */
export function distToPolyline(px, py, pts) {
  if (pts.length === 1) return dist(px, py, pts[0].x, pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const c = closestOnSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (c.d2 < best) best = c.d2;
  }
  return Math.sqrt(best);
}

export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return len;
}

/** Points along a polyline spaced `step` apart; keeps the first and the last point. */
export function resample(pts, step) {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a.x, a.y, b.x, b.y);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (dist(tail.x, tail.y, last.x, last.y) > step * 0.25) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}

/** True when segments AB and CD cross (touching endpoints count). */
export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

export function polygonBounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
