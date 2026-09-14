// lemniscate.js — đường cong hình số 8 (lemniscate of Bernoulli), tham số hoá
// lại theo ĐỘ DÀI CUNG.
//
//   x(t) = a · cos(t) / (1 + sin²(t))
//   y(t) = a · sin(t) · cos(t) / (1 + sin²(t))
//
// Đường cong đi qua gốc toạ độ tại t = π/2 và t = 3π/2 — điểm giao nằm đúng tâm,
// đó là lý do chọn công thức này.
//
// Tham số t chạy đều KHÔNG cho tốc độ đều: kiếm sẽ bò chậm ở hai đầu vòng rồi
// phóng vụt qua điểm giao. Nên phải dựng bảng tra độ dài cung một lần, sau đó
// mọi nơi chỉ dùng s ∈ [0,1) chạy đều.

const SAMPLES = 256;
const TAU = Math.PI * 2;

// Bảng dựng cho a = 1. Đổi `a` chỉ là nhân tỉ lệ toàn cục nên bảng không phải
// dựng lại — tham số hoá theo độ dài cung không đổi khi phóng to/thu nhỏ.
const tTable = new Float32Array(SAMPLES + 1);
const cumDist = new Float32Array(SAMPLES + 1);
let totalLength = 0;

function unitPoint(t, out) {
  const sin = Math.sin(t);
  const cos = Math.cos(t);
  const denom = 1 + sin * sin;
  out.x = cos / denom;
  out.y = sin * cos / denom;
  return out;
}

(function buildTable() {
  const cur = { x: 0, y: 0 };
  const prev = { x: 0, y: 0 };
  unitPoint(0, prev);
  tTable[0] = 0;
  cumDist[0] = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * TAU;
    unitPoint(t, cur);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    totalLength += Math.hypot(dx, dy);
    tTable[i] = t;
    cumDist[i] = totalLength;
    prev.x = cur.x;
    prev.y = cur.y;
  }
})();

// s ∈ [0,1) chạy đều theo độ dài cung → toạ độ 2D trên đường cong bán trục `a`.
export function lemniscatePoint(s01, a, out) {
  const s = ((s01 % 1) + 1) % 1;
  const targetDist = s * totalLength;

  let lo = 1;
  let hi = SAMPLES;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] < targetDist) lo = mid + 1;
    else hi = mid;
  }

  const d0 = cumDist[lo - 1];
  const d1 = cumDist[lo];
  const f = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
  const t = tTable[lo - 1] + (tTable[lo] - tTable[lo - 1]) * f;

  unitPoint(t, out);
  out.x *= a;
  out.y *= a;
  return out;
}
