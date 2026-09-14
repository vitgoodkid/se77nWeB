// quality.js — tự hạ chất lượng khi máy không theo kịp.
//
// Thứ tự hạ theo đúng đề xuất của plan: rẻ nhất trước. Độ phân giải bloom là
// thứ tốn GPU nhất mà mắt ít nhận ra nhất, nên hạ đầu tiên; rồi tới vệt sáng;
// cuối cùng mới giãn nhịp nhận diện tay — thường đó mới là chỗ tốn nhất, nhưng
// hạ nó xuống là cử chỉ phản ứng chậm hẳn nên để sau cùng.
const LEVELS = [
  { name: 'cao', pixelRatio: 2, bloomScale: 1, trailLength: null, handEveryNth: 1 },
  { name: 'vừa', pixelRatio: 1.5, bloomScale: 0.7, trailLength: 8, handEveryNth: 1 },
  { name: 'thấp', pixelRatio: 1, bloomScale: 0.5, trailLength: 5, handEveryNth: 2 },
];

export function createQuality({ config, renderer, bloomPass, tracker }) {
  const baseTrailLength = config.trail.length;
  let level = 0;
  let fps = 60;
  let belowFor = 0;
  let aboveFor = 0;
  let size = { w: 1, h: 1 };

  function apply() {
    const q = LEVELS[level];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    bloomPass.setSize(Math.max(1, size.w * q.bloomScale), Math.max(1, size.h * q.bloomScale));
    config.trail.length = q.trailLength ?? baseTrailLength;
    tracker?.setDetectInterval?.(q.handEveryNth);
  }

  function setSize(w, h) {
    size = { w, h };
    apply();
  }

  function update(dt) {
    if (!config.quality.auto) return;
    const instant = 1 / Math.max(dt, 1e-4);
    // Trung bình trượt: một khung hình chậm lẻ loi không được phép hạ chất lượng.
    fps += (instant - fps) * (1 - Math.exp(-2 * dt));

    if (fps < config.quality.downFps && level < LEVELS.length - 1) {
      belowFor += dt; aboveFor = 0;
      if (belowFor > config.quality.holdSeconds) { level++; belowFor = 0; apply(); }
    } else if (fps > config.quality.upFps && level > 0) {
      aboveFor += dt; belowFor = 0;
      // Lên lại phải chờ lâu hơn hẳn, nếu không sẽ nhấp nháy quanh ngưỡng.
      if (aboveFor > config.quality.holdSeconds * 3) { level--; aboveFor = 0; apply(); }
    } else {
      belowFor = 0; aboveFor = 0;
    }
  }

  return {
    update,
    setSize,
    get fps() { return fps; },
    get levelName() { return LEVELS[level].name; },
    get level() { return level; },
    setLevel(n) { level = Math.max(0, Math.min(LEVELS.length - 1, n)); apply(); },
  };
}
