// hand.js — Phase 5: lấy vị trí bàn tay từ webcam bằng MediaPipe HandLandmarker.
//
// Bốn cái bẫy của plan được xử lý ngay tại tầng này, không đẩy sang tầng chuyển
// động ở swarm.js:
//   1. Lật trục X — webcam soi gương; không lật thì giơ tay phải kiếm chạy trái.
//   2. Làm mượt landmark — toạ độ thô rung liên tục, cho qua trung bình trượt.
//      Không trông chờ hệ spring gánh hộ: spring đang để smoothTime rất thấp.
//   3. Chuẩn hoá toạ độ theo ĐÚNG tỉ lệ khung hình video, nếu không tay đi ngang
//      sẽ nhanh hơn đi dọc.
//   4. Mất tay vài frame là bình thường — giữ nguyên trạng thái cuối, để tầng
//      trên tự quyết định sau bao lâu mới cho đàn kiếm về nghỉ.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const LM_WRIST = 0;
const LM_MIDDLE_MCP = 9;
const LM_THUMB_TIP = 4;
const LM_INDEX_MCP = 5;
const LM_INDEX_TIP = 8;
const LM_PINKY_MCP = 17;
const FINGERTIPS = [8, 12, 16, 20];
const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];
// Mỗi ngón: [khớp giữa (PIP), đầu ngón (TIP)]. Đo độ duỗi bằng tỉ số khoảng
// cách tới cổ tay giữa đầu ngón và khớp giữa — duỗi thì đầu ngón xa cổ tay hơn
// khớp giữa, co thì gần hơn. Cách này không phụ thuộc bàn tay to nhỏ, xa gần,
// hay nghiêng kiểu gì, nên chắc hơn hẳn việc đo khoảng cách tới lòng bàn tay.
const FINGER_JOINTS = [[6, 8], [10, 12], [14, 16], [18, 20]];

export function createHandTracker({ config, video }) {
  const cfg = config.hand;

  let landmarker = null;
  let stream = null;
  let lastVideoTime = -1;
  let detectInterval = 1;
  let frameCounter = 0;
  // Vị trí tay chính ở frame trước, để bám đúng một bàn tay khi có hai tay.
  const primaryPrev = { x: 0.5, y: 0.5 };
  let hasPrimary = false;

  const smoother = createSmoother(cfg.smoothFrames);

  const state = {
    status: 'idle', // idle | loading | running | denied | unsupported | error
    message: '',
    present: false,
    lostSeconds: Infinity,
    x: 0.5,
    y: 0.5,
    size: cfg.baseSize,
    openness: 0,
    pinch: 1,
    // Độ duỗi từng ngón: > 1 là duỗi, < 1 là co.
    fingers: { index: 1, middle: 1, ring: 1, pinky: 1 },
    extended: { index: true, middle: true, ring: true, pinky: true },
    extendedCount: 4,
    // Ngón cái đo riêng: khớp nó xoay khác hẳn bốn ngón kia nên tỉ số "đầu ngón
    // xa cổ tay hơn khớp giữa" không dùng được. Thay bằng khoảng cách từ đầu
    // ngón cái tới khớp gốc ngón út — nắm tay thì ngón cái nằm vắt ngang lòng
    // bàn tay (gần), giơ ngón cái thì nó chìa hẳn ra (xa).
    thumbSpread: 1,
    thumbExtended: false,
    dirX: 0,
    dirY: -1,
    angle: 0,  // góc nghiêng bàn tay (cổ tay → khớp ngón giữa), radian
    pointX: 0, // hướng ngón trỏ (khớp gốc → đầu ngón), toạ độ ảnh
    pointY: -1,
    twoHands: false,
    separation: 0, // khoảng cách hai bàn tay, tính theo chiều cao khung hình
    videoAspect: 16 / 9,
  };

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      state.status = 'unsupported';
      state.message = 'Trình duyệt này không hỗ trợ webcam (getUserMedia).';
      return false;
    }

    state.status = 'loading';
    state.message = 'Đang xin quyền camera…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: cfg.videoWidth }, height: { ideal: cfg.videoHeight } },
        audio: false,
      });
    } catch (err) {
      state.status = err?.name === 'NotAllowedError' ? 'denied' : 'error';
      state.message = state.status === 'denied'
        ? 'Bạn đã từ chối quyền camera. Cho phép trong thanh địa chỉ rồi thử lại.'
        : 'Không mở được camera: ' + (err?.message || err);
      return false;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      state.status = 'error';
      state.message = 'Không phát được luồng video: ' + (err?.message || err);
      stop();
      return false;
    }

    state.message = 'Đang tải mô hình nhận diện tay…';
    try {
      const fileset = await FilesetResolver.forVisionTasks(cfg.wasmUrl);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: cfg.modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: cfg.numHands,
      });
    } catch (err) {
      state.status = 'error';
      state.message = 'Không tải được mô hình nhận diện tay: ' + (err?.message || err);
      stop();
      return false;
    }

    state.status = 'running';
    state.message = '';
    return true;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
    landmarker?.close?.();
    landmarker = null;
    if (state.status === 'running') state.status = 'idle';
  }

  // Giãn nhịp nhận diện khi máy yếu. Nhận diện tay thường tốn hơn cả render,
  // nhưng giãn nó ra là cử chỉ phản ứng chậm hẳn, nên đây là bậc hạ cuối cùng.
  function setDetectInterval(n) { detectInterval = Math.max(1, Math.round(n)); }

  function update(nowMs, dt) {
    if (state.status !== 'running' || !landmarker) return state;

    state.lostSeconds += dt;

    frameCounter++;
    if (frameCounter % detectInterval !== 0) return state;

    if (video.readyState < 2 || !video.videoWidth) return state;
    state.videoAspect = video.videoWidth / video.videoHeight;

    // Chỉ chạy nhận diện khi video thật sự có khung hình mới — gọi lại với cùng
    // một timestamp sẽ làm MediaPipe ném lỗi.
    if (video.currentTime === lastVideoTime) return state;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = landmarker.detectForVideo(video, nowMs);
    } catch {
      return state;
    }

    const hands = result?.landmarks;
    if (!hands?.length) {
      state.present = false;
      state.twoHands = false;
      hasPrimary = false;
      return state;
    }

    // MediaPipe KHÔNG bảo đảm thứ tự hai bàn tay giữ nguyên giữa các frame. Nếu
    // cứ lấy hands[0] thì khi có hai tay, "tay chính" sẽ nhảy qua lại mỗi frame,
    // làm vận tốc và cử chỉ loạn hết. Chọn bàn tay gần vị trí tay chính của
    // frame trước nhất.
    let hand = hands[0];
    if (hands.length > 1) {
      if (hasPrimary) {
        let best = Infinity;
        for (const h of hands) {
          const d = dist(h[LM_MIDDLE_MCP], primaryPrev, state.videoAspect);
          if (d < best) { best = d; hand = h; }
        }
      }
      const other = hands.find((h) => h !== hand);
      state.separation = dist(hand[LM_MIDDLE_MCP], other[LM_MIDDLE_MCP], state.videoAspect);
    }
    state.twoHands = hands.length > 1;
    primaryPrev.x = hand[LM_MIDDLE_MCP].x;
    primaryPrev.y = hand[LM_MIDDLE_MCP].y;
    hasPrimary = true;

    const wrist = hand[LM_WRIST];
    const mcp = hand[LM_MIDDLE_MCP];

    // Kích thước bàn tay trên khung hình — proxy độ sâu, phải sửa theo tỉ lệ
    // khung hình trước khi đo, nếu không tay nghiêng ngang sẽ "to" hơn tay dọc.
    const size = dist(wrist, mcp, state.videoAspect);

    let openSum = 0;
    for (const tip of FINGERTIPS) openSum += dist(hand[tip], mcp, state.videoAspect);
    const openness = size > 1e-5 ? openSum / FINGERTIPS.length / size : 0;

    // Độ duỗi từng ngón, đo bằng tỉ số khoảng cách tới cổ tay.
    const extend = {};
    for (let f = 0; f < FINGER_JOINTS.length; f++) {
      const [pip, tip] = FINGER_JOINTS[f];
      const dPip = dist(hand[pip], wrist, state.videoAspect);
      const dTip = dist(hand[tip], wrist, state.videoAspect);
      extend[FINGER_NAMES[f]] = dPip > 1e-5 ? dTip / dPip : 1;
    }
    const pinch = size > 1e-5
      ? dist(hand[LM_THUMB_TIP], hand[LM_INDEX_TIP], state.videoAspect) / size
      : 1;

    const thumbSpread = size > 1e-5
      ? dist(hand[LM_THUMB_TIP], hand[LM_PINKY_MCP], state.videoAspect) / size
      : 1;

    const s = smoother.push({
      x: mcp.x, y: mcp.y, size, openness, pinch, thumbSpread,
      index: extend.index, middle: extend.middle, ring: extend.ring, pinky: extend.pinky,
    });
    state.thumbSpread = s.thumbSpread;
    state.thumbExtended = s.thumbSpread
      > (state.thumbExtended ? cfg.thumbCurlSpread : cfg.thumbExtendSpread);
    state.x = s.x;
    state.y = s.y;
    state.size = s.size;
    state.openness = s.openness;
    state.pinch = s.pinch;

    let extendedCount = 0;
    for (const name of FINGER_NAMES) {
      state.fingers[name] = s[name];
      // Trễ trạng thái ngay ở mức từng ngón: đã duỗi thì phải co hẳn xuống dưới
      // ngưỡng thấp mới coi là co, và ngược lại.
      const was = state.extended[name];
      const threshold = was ? cfg.fingerCurlRatio : cfg.fingerExtendRatio;
      state.extended[name] = s[name] > threshold;
      if (state.extended[name]) extendedCount++;
    }
    state.extendedCount = extendedCount;
    state.dirX = mcp.x - wrist.x;
    state.dirY = mcp.y - wrist.y;
    state.angle = Math.atan2(state.dirY, state.dirX * state.videoAspect);
    state.pointX = hand[LM_INDEX_TIP].x - hand[LM_INDEX_MCP].x;
    state.pointY = hand[LM_INDEX_TIP].y - hand[LM_INDEX_MCP].y;
    state.present = true;
    state.lostSeconds = 0;
    return state;
  }

  return { state, start, stop, update, setDetectInterval };
}

function dist(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Trung bình trượt trên vài frame gần nhất. Rẻ, đủ để dập rung của landmark
// mà không thêm độ trễ đáng kể ở mức 3–5 frame.
function createSmoother(frames) {
  const n = Math.max(1, Math.round(frames));
  const keys = ['x', 'y', 'size', 'openness', 'pinch', 'thumbSpread',
    'index', 'middle', 'ring', 'pinky'];
  const buf = Object.fromEntries(keys.map((k) => [k, new Float32Array(n)]));
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  let filled = 0;
  let head = 0;

  return {
    push(values) {
      head = (head + 1) % n;
      if (filled < n) filled++;
      for (const k of keys) {
        buf[k][head] = values[k];
        let sum = 0;
        for (let i = 0; i < filled; i++) sum += buf[k][(head - i + n) % n];
        out[k] = sum / filled;
      }
      return out;
    },
  };
}
