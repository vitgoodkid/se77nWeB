// calibration.js — tự căn ngưỡng cử chỉ theo bàn tay THẬT của người dùng.
//
// Bàn tay mỗi người một khác: tỉ lệ ngón, độ cong khớp, thói quen nắm tay. Bộ
// ngưỡng mặc định chỉ là con số đoán, và nếu nó lệch thì 13 cử chỉ đều nhận sai.
// Thay vì bắt người dùng dò từng thanh trượt, ở đây lần lượt yêu cầu vài thế
// tay, đo số thật của họ rồi đặt ngưỡng vào/ra ôm quanh các số đó.
//
// Kết quả lưu vào localStorage nên chỉ phải làm một lần.
const STORAGE_KEY = 'cultivation.calibration.v1';

const STEPS = [
  { id: 'open', label: 'Xoè cả bàn tay', hint: 'năm ngón duỗi thẳng, hướng vào camera' },
  { id: 'fist', label: 'Nắm tay lại', hint: 'ngón cái ôm vào trong lòng bàn tay' },
  { id: 'thumb', label: 'Giơ ngón cái', hint: 'vẫn nắm tay, chìa riêng ngón cái ra' },
  { id: 'pinch', label: 'Kẹp ngón cái và ngón trỏ', hint: 'hai đầu ngón chạm nhau' },
];

const READY_SECONDS = 1.4;  // thời gian để kịp vào thế
const SAMPLE_SECONDS = 1.2; // thời gian lấy mẫu

export function createCalibration({ config, onStatus, onFinish }) {
  let stepIndex = -1;
  let phase = 'idle'; // idle | ready | sampling | done
  let timer = 0;
  let samples = null;
  const results = {};

  function start() {
    stepIndex = 0;
    phase = 'ready';
    timer = 0;
    resetSamples();
    report();
  }

  function cancel() {
    phase = 'idle';
    stepIndex = -1;
    onStatus?.(null);
  }

  function resetSamples() {
    samples = { n: 0, finger: 0, thumbSpread: 0, pinch: 0 };
  }

  function report(extra) {
    if (phase === 'idle') return onStatus?.(null);
    const step = STEPS[stepIndex];
    onStatus?.({
      index: stepIndex,
      total: STEPS.length,
      label: step?.label,
      hint: step?.hint,
      phase,
      progress: phase === 'sampling' ? timer / SAMPLE_SECONDS : timer / READY_SECONDS,
      message: extra,
    });
  }

  function update(dt, hand) {
    if (phase === 'idle' || phase === 'done') return false;

    // Không thấy tay thì đứng chờ, không tính giờ — đỡ phải làm lại từ đầu.
    if (!hand?.present) {
      report('Không thấy tay — giơ tay vào khung hình');
      return true;
    }

    timer += dt;

    if (phase === 'ready') {
      if (timer >= READY_SECONDS) { phase = 'sampling'; timer = 0; resetSamples(); }
      report();
      return true;
    }

    const f = hand.fingers;
    samples.n++;
    samples.finger += (f.index + f.middle + f.ring + f.pinky) / 4;
    samples.thumbSpread += hand.thumbSpread;
    samples.pinch += hand.pinch;

    if (timer >= SAMPLE_SECONDS) {
      results[STEPS[stepIndex].id] = {
        finger: samples.finger / samples.n,
        thumbSpread: samples.thumbSpread / samples.n,
        pinch: samples.pinch / samples.n,
      };
      stepIndex++;
      if (stepIndex >= STEPS.length) return finish();
      phase = 'ready';
      timer = 0;
    }
    report();
    return true;
  }

  function finish() {
    phase = 'done';
    const derived = derive(results);
    if (!derived) {
      onStatus?.({ phase: 'failed', message: 'Các thế tay đo được quá giống nhau — giữ ngưỡng cũ. Thử lại và làm dứt khoát hơn.' });
      onFinish?.(null);
      return false;
    }
    applyToConfig(config, derived);
    save(derived);
    onStatus?.({ phase: 'done', message: 'Đã căn xong theo bàn tay của bạn.' });
    onFinish?.(derived);
    return false;
  }

  return { start, cancel, update, get active() { return phase !== 'idle' && phase !== 'done'; } };
}

// Ngưỡng vào và ngưỡng ra đặt lệch nhau trong khoảng giữa hai thế đo được —
// đó chính là phần trễ trạng thái, giờ tính theo số thật thay vì đoán.
function derive(r) {
  if (!r.open || !r.fist || !r.thumb || !r.pinch) return null;

  const fingerSpan = r.open.finger - r.fist.finger;
  const thumbSpan = r.thumb.thumbSpread - r.fist.thumbSpread;
  const pinchSpan = r.open.pinch - r.pinch.pinch;
  // Hai thế quá giống nhau nghĩa là người dùng làm chưa dứt khoát hoặc nhận
  // diện sai — đặt ngưỡng theo số đó còn tệ hơn giữ mặc định.
  if (fingerSpan < 0.12 || thumbSpan < 0.12 || pinchSpan < 0.15) return null;

  return {
    fingerExtendRatio: r.fist.finger + fingerSpan * 0.62,
    fingerCurlRatio: r.fist.finger + fingerSpan * 0.42,
    thumbExtendSpread: r.fist.thumbSpread + thumbSpan * 0.62,
    thumbCurlSpread: r.fist.thumbSpread + thumbSpan * 0.42,
    pinchEnter: r.pinch.pinch + pinchSpan * 0.35,
    pinchExit: r.pinch.pinch + pinchSpan * 0.55,
  };
}

function applyToConfig(config, d) {
  config.hand.fingerExtendRatio = d.fingerExtendRatio;
  config.hand.fingerCurlRatio = d.fingerCurlRatio;
  config.hand.thumbExtendSpread = d.thumbExtendSpread;
  config.hand.thumbCurlSpread = d.thumbCurlSpread;
  config.gesture.pinchEnter = d.pinchEnter;
  config.gesture.pinchExit = d.pinchExit;
}

function save(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch { /* bỏ qua */ }
}

// Nạp lại kết quả lần trước, gọi lúc khởi động.
export function loadCalibration(config) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!Number.isFinite(d?.fingerExtendRatio)) return false;
    applyToConfig(config, d);
    return true;
  } catch {
    return false;
  }
}

export function clearCalibration() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* bỏ qua */ }
}
