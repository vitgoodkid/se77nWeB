// main.js — đàn 10–100 thanh kiếm chạy trên quỹ đạo vô cực, tâm bám theo con trỏ.
// Chuột đóng vai vị trí bàn tay giả lập; phase 5 chỉ thay nguồn dữ liệu này
// bằng webcam, toàn bộ phần chuyển động bên dưới giữ nguyên.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { CONFIG } from './config.js';
import { buildSwordGeometry } from './sword.js';
import { createSwarm } from './swarm.js';
import { createTrail } from './trail.js';
import { createHandTracker } from './hand.js';
import { createGestureClassifier } from './gesture.js';
import { createDrift, createCameraRig } from './control.js';
import { createBackground } from './background.js';
import { createCalibration, loadCalibration } from './calibration.js';
import { createQuality } from './quality.js';
import { createAttract } from './attract.js';

// Nạp lại ngưỡng cử chỉ đã căn lần trước, TRƯỚC khi dựng gì khác.
const hasSavedCalibration = loadCalibration(CONFIG);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.render.exposure;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.render.bgColor);
scene.fog = new THREE.FogExp2(CONFIG.render.bgColor, CONFIG.render.fogDensity);

const camera = new THREE.PerspectiveCamera(CONFIG.render.cameraFov, 1, 0.1, 100);
camera.position.set(0, CONFIG.render.cameraHeight, CONFIG.render.cameraDistance);
camera.lookAt(0, 0, 0);

// Ánh sáng scene tối thiểu — nguồn sáng chính đến từ chính kiếm (emissive),
// không phải đèn.
scene.add(new THREE.AmbientLight(0xffffff, CONFIG.render.ambientIntensity));
const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.render.directionalIntensity);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

const geometry = buildSwordGeometry(CONFIG.sword.geometry);

function makeMaterial(cfg) {
  return new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: new THREE.Color(cfg.emissive),
    emissiveIntensity: cfg.emissiveIntensity,
    metalness: cfg.metalness,
    roughness: cfg.roughness,
  });
}
// group 0 (từ mergeGeometries) = pommel+chuôi+chắn tay, group 1 = lưỡi kiếm.
const metalMaterial = makeMaterial(CONFIG.sword.metal);
const bladeMaterial = makeMaterial(CONFIG.sword.blade);
const swarm = createSwarm({
  geometry,
  materials: [metalMaterial, bladeMaterial],
  config: CONFIG,
});
scene.add(swarm.mesh);

const g = CONFIG.sword.geometry;
const trail = createTrail({
  maxSwords: CONFIG.swarm.maxCount,
  tipLocalY: g.hiltLength + g.guardHeight + g.bladeLength,
  config: CONFIG,
});
scene.add(trail.mesh);

// Nền hạt phải có TRƯỚC mọi thứ khác về cảm giác chuyển động: không có vật mốc
// thì bay nhanh hay chậm nhìn y như nhau.
const background = createBackground(CONFIG);
scene.add(background.group);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(1, 1),
  CONFIG.bloom.strength,
  CONFIG.bloom.radius,
  CONFIG.bloom.threshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ─── Nguồn điều khiển ───
// Hai nguồn cùng ghi vào một biến `handPos`: bàn tay qua webcam (mặc định) và
// con trỏ chuột (dự phòng khi không có/không cho phép camera).
const handPos = new THREE.Vector3(0, 0, 0);
const pointer = new THREE.Vector2(0, 0);
const rayDir = new THREE.Vector3();
let inputMode = 'mouse'; // 'mouse' | 'hand'

function updateHandPosFromPointer() {
  // Bắn tia từ camera qua con trỏ, cắt mặt phẳng đi qua điểm camera đang ngắm —
  // không phải mặt phẳng z = 0, vì camera đã dời theo đàn kiếm trong không gian
  // vô hạn và gốc toạ độ có thể nằm ngoài khung hình từ lâu.
  rayDir.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
  const planeZ = cameraRig.target.z;
  const t = Math.abs(rayDir.z) > 1e-6 ? (planeZ - camera.position.z) / rayDir.z : 0;
  handPos.copy(camera.position).addScaledVector(rayDir, t);
}

window.addEventListener('pointermove', (e) => {
  if (inputMode !== 'mouse') return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  updateHandPosFromPointer();
});

const video = document.getElementById('cult-video');
const tracker = createHandTracker({ config: CONFIG, video });
const gestures = createGestureClassifier(CONFIG);
const pointDir = new THREE.Vector3(0, 1, 0);

// Chiều cao vùng nhìn thấy tại mặt phẳng z = 0; dùng một hệ số tỉ lệ DUY NHẤT
// cho cả hai trục để giữ đúng tỉ lệ khung hình — nếu co giãn riêng từng trục
// thì tay đi ngang sẽ nhanh hơn đi dọc.
function viewHeightAtOrigin() {
  // Đọc FOV và khoảng cách HIỆN TẠI của camera, không đọc config — cả hai đều
  // thay đổi liên tục (FOV theo tốc độ, khoảng cách theo biên độ đàn kiếm).
  const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  return 2 * Math.tan(halfFov) * cameraRig.distance;
}

// Vị trí tay quy ra toạ độ thế giới. Chỉ dùng để lấy VẬN TỐC của tay — bản thân
// vị trí không còn điều khiển gì, vì bàn tay luôn phải dừng và quay về giữa
// khung, mà điều đó không được phép kéo đàn kiếm ngược lại.
const handWorld = new THREE.Vector3();
const handWorldPrev = new THREE.Vector3();
const handWorldVel = new THREE.Vector3();
const drift = createDrift(CONFIG);
const cameraRig = createCameraRig(CONFIG, camera);
let hasHandWorldPrev = false;
let prevHandAngle = 0;
let hasPrevHandAngle = false;
let handSpin = 0;

function updateHandWorld(state) {
  const scale = viewHeightAtOrigin() * CONFIG.hand.reach;
  // Lật trục X: webcam soi gương, không lật là giơ tay phải kiếm chạy sang trái.
  handWorld.x = -(state.x - 0.5) * state.videoAspect * scale;
  handWorld.y = -(state.y - 0.5) * scale;
  // Tay to = ở gần camera → đàn kiếm tiến về phía người xem.
  const depth = (state.size - CONFIG.hand.baseSize) * CONFIG.hand.depthGain;
  handWorld.z = THREE.MathUtils.clamp(depth, -CONFIG.hand.depthClamp, CONFIG.hand.depthClamp);
}

// Tốc độ xoay cổ tay, tính từ góc bàn tay. Dùng hiệu góc ngắn nhất để không
// nhảy 2π mỗi lần góc vượt qua ±180°.
function updateHandSpin(state, dt) {
  if (!hasPrevHandAngle) { prevHandAngle = state.angle; hasPrevHandAngle = true; return; }
  let d = state.angle - prevHandAngle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  prevHandAngle = state.angle;
  const instant = d / Math.max(dt, 1e-3) / (Math.PI * 2); // vòng/giây
  handSpin += (instant - handSpin) * (1 - Math.exp(-8 * dt));
}

function updateInput(dt, nowMs) {
  if (inputMode !== 'hand') return null;
  const state = tracker.update(nowMs, dt);

  let driving = false;
  let handSpeed = 0;

  if (state.present) {
    updateHandWorld(state);
    if (hasHandWorldPrev) {
      handWorldVel.subVectors(handWorld, handWorldPrev).divideScalar(Math.max(dt, 1e-3));
    }
    handWorldPrev.copy(handWorld);
    hasHandWorldPrev = true;
    handSpeed = handWorldVel.length();
    // Hai tay trong khung là đang ra dấu zoom — lúc đó tay nào cũng đang chuyển
    // động, không được để nó vô tình lái đàn kiếm đi.
    driving = !state.twoHands && handSpeed > CONFIG.control.moveThreshold;

    updateHandSpin(state, dt);
    // Hướng ngón trỏ: lật X (webcam soi gương) và lật Y (trục ảnh hướng xuống).
    pointDir.set(-state.pointX, -state.pointY, 0);
    swarm.setPointDirection(pointDir);

    // Hai tay trong khung là đang ra dấu zoom — tạm ngưng đổi đội hình để cử
    // chỉ zoom không vô tình bị đọc thành nắm tay/xoè tay.
    if (!state.twoHands) swarm.setFormation(gestures.update(state, handSpeed));
  } else {
    // Mất tay: KHÔNG kéo đàn kiếm về đâu cả, cũng không đổi đội hình. Nó giữ
    // nguyên quán tính và cử chỉ cuối cùng, đúng như khi tay đứng yên.
    hasHandWorldPrev = false;
    hasPrevHandAngle = false;
    handSpin = 0;
  }

  // Nắm tay vừa là đội hình chụm, vừa là cử chỉ hãm.
  const braking = swarm.formation === 'sphere';
  // Xoay cổ tay lúc đang nắm → cụm kiếm quay nhanh theo.
  const spinning = braking
    || ['ring', 'helix', 'vortex', 'dome', 'rings', 'spiral'].includes(swarm.formation);
  swarm.setSpinBoost(spinning ? handSpin * CONFIG.formations.spinFromHand : 0);

  drift.update(dt, handPos, { driving, braking, handVelocity: handWorldVel });
  updateHandStatus(state, handSpeed);
  return state;
}


// ─── Màn hình chờ + trạng thái ───
const gate = document.getElementById('cult-gate');
const gateStatus = document.getElementById('gate-status');
const hud = document.getElementById('cult-hud');
const handStatus = document.getElementById('cult-hand-status');
const caption = document.getElementById('cult-caption');

const GESTURE_LABEL = {
  infinity: 'VÔ CỰC (xoè tay)',
  sphere: 'CHỤM · HÃM (nắm tay)',
  field: 'TẢN KÍN MÀN HÌNH (xoè khi đang chụm)',
  column: 'MŨI GIÁO (chỉ trỏ)',
  helix: 'XOẮN KÉP (chữ V)',
  vortex: 'LỐC XOÁY (trỏ + út)',
  wall: 'TƯỜNG KIẾM (ba ngón)',
  dome: 'VÒM KHIÊN (giơ ngón cái)',
  chain: 'DÂY KIẾM (chỉ ngón út)',
  rings: 'VÀNH ĐAI (cái + út)',
  arrow: 'MŨI TÊN (cái + trỏ)',
  ring: 'VÒNG XOAY (kẹp ngón, xoè)',
  spiral: 'XOẮN ỐC (kẹp ngón, nắm)',
};

function updateHandStatus(state, handSpeed) {
  const label = GESTURE_LABEL[swarm.formation] || swarm.formation;
  if (!state.present) {
    // Mất tay không còn là lỗi: đàn kiếm vẫn bay theo quán tính và giữ cử chỉ.
    handStatus.textContent = `${label}  ·  KHÔNG THẤY TAY — vẫn bay theo quán tính`;
    handStatus.style.color = 'rgba(255,190,120,0.9)';
    return;
  }
  handStatus.style.color = '#dfeeff';
  if (state.twoHands) {
    handStatus.textContent = `ZOOM 2 TAY  ·  giang ra = xa, chụm lại = gần  ·  ×${cameraRig.zoomFactor.toFixed(2)}`;
    return;
  }
  // Số đo hiện ngay cạnh khung hình để căn ngưỡng cử chỉ — bàn tay mỗi người
  // một khác, không nhìn số thật thì không đặt ngưỡng đúng được.
  const e = state.extended;
  const dots = ['index', 'middle', 'ring', 'pinky'].map((k) => (e[k] ? '|' : '·')).join('');
  handStatus.textContent =
    `${label}  ·  ngón ${dots} (${state.extendedCount})  cái ${state.thumbExtended ? '|' : '·'}${state.thumbSpread.toFixed(2)}  kẹp ${state.pinch.toFixed(2)}  `
    + `· tốc ${handSpeed.toFixed(1)}  xoay ${handSpin.toFixed(1)}  `
    + `· ${quality.fps.toFixed(0)}fps ${quality.levelName}`;
}

document.getElementById('gate-cam').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  gateStatus.textContent = 'Đang xin quyền camera…';
  const ok = await tracker.start();
  gateStatus.textContent = tracker.state.message;
  if (!ok) { btn.disabled = false; return; }
  inputMode = 'hand';
  gate.hidden = true;
  hud.hidden = false;
  caption.textContent = hasSavedCalibration
    ? '? xem cử chỉ · K căn lại cử chỉ'
    : 'Nhấn K để căn cử chỉ theo tay bạn (nên làm) · ? xem danh sách cử chỉ';
});

document.getElementById('gate-mouse').addEventListener('click', () => {
  inputMode = 'mouse';
  gate.hidden = true;
  caption.textContent = 'Rê chuột để điều khiển · nhấn H để ẩn bảng chỉnh';
});

const quality = createQuality({ config: CONFIG, renderer, bloomPass, tracker });
const attract = createAttract(CONFIG);
const attractCenter = new THREE.Vector3();
// Mọi thao tác của người dùng đều tính là "đang bận" để cắt chế độ tự diễn.
let userActiveSince = 0;
const markUserActive = () => { userActiveSince = 0; };
window.addEventListener('pointermove', markUserActive);
window.addEventListener('pointerdown', markUserActive);
window.addEventListener('keydown', markUserActive);
window.addEventListener('wheel', markUserActive, { passive: true });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  // Áp lại bậc chất lượng sau khi đổi kích thước — composer.setSize vừa đặt
  // bloom về đúng độ phân giải đầy đủ.
  quality.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();
updateHandPosFromPointer();
swarm.snapToOrbit(handPos);
trail.reset(swarm.swords, swarm.count);

// ─── lil-gui: 4 số bloom + exposure lên bảng ngay từ phase 1, theo yêu cầu plan ───
const gui = new GUI({ title: 'Ngự Kiếm · tune' });
const bloomFolder = gui.addFolder('Bloom');
bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);
bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
bloomFolder.add(bloomPass, 'radius', 0, 1, 0.01);
bloomFolder.add(renderer, 'toneMappingExposure', 0, 2, 0.01).name('exposure');

const bladeFolder = gui.addFolder('Blade (glow)');
bladeFolder.addColor(CONFIG.sword.blade, 'emissive').name('emissive color')
  .onChange((v) => bladeMaterial.emissive.set(v));
bladeFolder.add(bladeMaterial, 'emissiveIntensity', 0, 6, 0.1);
bladeFolder.add(bladeMaterial, 'metalness', 0, 1, 0.01);
bladeFolder.add(bladeMaterial, 'roughness', 0, 1, 0.01);

const metalFolder = gui.addFolder('Hilt (metal)');
metalFolder.add(metalMaterial, 'emissiveIntensity', 0, 2, 0.05);
metalFolder.add(metalMaterial, 'metalness', 0, 1, 0.01);
metalFolder.add(metalMaterial, 'roughness', 0, 1, 0.01);

const orbitFolder = gui.addFolder('Orbit (∞)');
orbitFolder.add(CONFIG.orbit, 'a', 0.5, 4, 0.05).name('size a');
orbitFolder.add(CONFIG.orbit, 'baseSpeed', 0, 1, 0.01).name('orbit speed');
orbitFolder.add(CONFIG.orbit, 'speedGain', 0, 0.3, 0.005).name('speed gain');
orbitFolder.add(CONFIG.orbit, 'maxDelay', 0, 0.6, 0.01).name('max delay ★');
orbitFolder.add(CONFIG.orbit, 'laneOffset', 0, 0.25, 0.005).name('lane offset');
orbitFolder.add(CONFIG.orbit, 'laneBraid').name('lane braid');
orbitFolder.add(CONFIG.orbit, 'stretchGain', 0, 0.3, 0.005).name('stretch gain');
orbitFolder.add(CONFIG.orbit, 'swirlAmp', 0, 0.2, 0.005).name('swirl amp');
orbitFolder.add(CONFIG.orbit, 'swirlFreq', 0, 5, 0.1).name('swirl freq');
orbitFolder.add(CONFIG.orbit, 'restTiltDeg', 0, 80, 1).name('rest tilt°');

const spearFolder = gui.addFolder('Spear (đang bay)');
spearFolder.add(CONFIG.spear, 'blendSpeed', 0.5, 10, 0.1).name('blend speed ★');
spearFolder.add(CONFIG.spear, 'length', 0.5, 6, 0.1).name('length');
spearFolder.add(CONFIG.spear, 'radius', 0.05, 2, 0.05).name('radius');
spearFolder.add(CONFIG.spear, 'taper', 0.2, 3, 0.05).name('taper');
spearFolder.add(CONFIG.spear, 'pathFollow', 0, 1, 0.05).name('path follow ★');
spearFolder.add(CONFIG.spear, 'pathSample', 0.01, 0.2, 0.01).name('path sample');
spearFolder.add(CONFIG.spear, 'twistTurns', 0, 4, 0.1).name('twist turns');
spearFolder.add(CONFIG.spear, 'alignToStrand', 0, 1, 0.05).name('align to strand');
spearFolder.add(CONFIG.spear, 'strands', 1, 8, 1).name('strands');
spearFolder.add(CONFIG.spear, 'spinTurns', 0, 4, 0.1).name('spin turns');
spearFolder.add(CONFIG.spear, 'delayAlong', 0, 2, 0.05).name('tail delay');

const motionFolder = gui.addFolder('Motion');
motionFolder.add(CONFIG.motion, 'smoothTime', 0.03, 0.6, 0.01).name('smoothTime');
motionFolder.add(CONFIG.motion, 'stagger', 0, 2, 0.05);
motionFolder.add(CONFIG.motion, 'turnRate', 1, 25, 0.5).name('turn rate');
motionFolder.add(CONFIG.motion, 'aimSpeed', 0.2, 6, 0.1).name('aim speed');
motionFolder.add(CONFIG.motion, 'bankGain', 0, 0.2, 0.005).name('bank gain');
motionFolder.add(CONFIG.motion, 'bankMaxDeg', 0, 60, 1).name('bank max°');
motionFolder.add(CONFIG.motion, 'maxSpeed', 2, 40, 1).name('max speed');

const trailFolder = gui.addFolder('Trail');
trailFolder.add(CONFIG.trail, 'enabled');
trailFolder.add(CONFIG.trail, 'length', 2, CONFIG.trail.maxSegments, 1);
trailFolder.add(CONFIG.trail, 'width', 0, 0.4, 0.005);
trailFolder.add(CONFIG.trail, 'opacity', 0, 1, 0.02);
trailFolder.add(CONFIG.trail, 'fadePower', 0.2, 4, 0.1).name('fade power');
trailFolder.add(CONFIG.trail, 'tipFactor', 0, 1.2, 0.05).name('tip factor');
trailFolder.addColor(CONFIG.trail, 'color').onChange((v) => trail.setColor(v));

const gestureFolder = gui.addFolder('Gesture');
gestureFolder.add(CONFIG.gesture, 'enabled');
gestureFolder.add(CONFIG.gesture, 'stableFrames', 1, 20, 1).name('stable frames');
gestureFolder.add(CONFIG.gesture, 'pinchEnter', 0.1, 1.2, 0.01).name('pinch enter');
gestureFolder.add(CONFIG.gesture, 'pinchExit', 0.1, 1.5, 0.01).name('pinch exit');
gestureFolder.add(CONFIG.hand, 'fingerExtendRatio', 0.8, 2, 0.01).name('finger extend');
gestureFolder.add(CONFIG.hand, 'fingerCurlRatio', 0.7, 1.9, 0.01).name('finger curl');
gestureFolder.add(CONFIG.hand, 'thumbExtendSpread', 0.8, 3, 0.01).name('thumb extend');
gestureFolder.add(CONFIG.hand, 'thumbCurlSpread', 0.7, 2.8, 0.01).name('thumb curl');
gestureFolder.add(CONFIG.gesture, 'scatterExitSpeed', 0.1, 5, 0.05).name('field exit speed');

const formFolder = gui.addFolder('Formations');
formFolder.add(CONFIG.formations, 'blendSeconds', 0.05, 2, 0.05).name('blend sec');
formFolder.add(CONFIG.formations.sphere, 'radius', 0.2, 3, 0.05).name('sphere radius');
formFolder.add(CONFIG.formations.field, 'fill', 0.3, 1.2, 0.02).name('field fill');
formFolder.add(CONFIG.formations.field, 'jitter', 0, 0.3, 0.01).name('field jitter');
formFolder.add(CONFIG.formations.field, 'depth', 0, 4, 0.1).name('field depth');
formFolder.add(CONFIG.formations.ring, 'radius', 0.2, 3, 0.05).name('ring radius');
formFolder.add(CONFIG.formations.ring, 'spinTurns', 0, 3, 0.05).name('ring spin');
formFolder.add(CONFIG.formations.column, 'length', 0.5, 6, 0.1).name('column length');
formFolder.add(CONFIG.formations.column, 'radius', 0.05, 2, 0.05).name('column radius');
formFolder.add(CONFIG.formations.column, 'twistTurns', 0, 4, 0.1).name('column twist');
formFolder.add(CONFIG.formations.helix, 'radius', 0.2, 3, 0.05).name('helix radius');
formFolder.add(CONFIG.formations.helix, 'turns', 0.5, 6, 0.1).name('helix turns');
formFolder.add(CONFIG.formations.vortex, 'radiusTop', 0.3, 4, 0.05).name('vortex top r');
formFolder.add(CONFIG.formations.vortex, 'shear', 0, 4, 0.1).name('vortex shear');
formFolder.add(CONFIG.formations.wall, 'waves', 0.2, 5, 0.1).name('wall waves');
formFolder.add(CONFIG.formations.wall, 'waveAmp', 0, 1.5, 0.05).name('wall wave amp');
formFolder.add(CONFIG.formations.dome, 'radius', 0.3, 4, 0.05).name('dome radius');
formFolder.add(CONFIG.formations.chain, 'waves', 0.3, 5, 0.1).name('chain waves');
formFolder.add(CONFIG.formations.chain, 'amplitude', 0, 2, 0.05).name('chain amp');
formFolder.add(CONFIG.formations.rings, 'count', 2, 8, 1).name('rings count');
formFolder.add(CONFIG.formations.rings, 'gap', 0.1, 1.2, 0.02).name('rings gap');
formFolder.add(CONFIG.formations.arrow, 'spreadDeg', 10, 80, 1).name('arrow spread');
formFolder.add(CONFIG.formations.spiral, 'arms', 1, 6, 1).name('spiral arms');
formFolder.add(CONFIG.formations.spiral, 'turns', 0.2, 3, 0.05).name('spiral turns');

const handFolder = gui.addFolder('Hand (webcam)');
handFolder.add(CONFIG.hand, 'reach', 0.4, 2.5, 0.05).name('reach');
handFolder.add(CONFIG.hand, 'baseSize', 0.05, 0.5, 0.01).name('base size');
handFolder.add(CONFIG.hand, 'depthGain', 0, 20, 0.5).name('depth gain');

const controlFolder = gui.addFolder('Control (quán tính)');
controlFolder.add(CONFIG.control, 'throwGain', 0, 3, 0.05).name('throw gain');
controlFolder.add(CONFIG.control, 'glideDamping', 0, 2, 0.01).name('glide damping');
controlFolder.add(CONFIG.control, 'brakeRate', 0.5, 20, 0.5).name('brake rate');
controlFolder.add(CONFIG.control, 'moveThreshold', 0, 3, 0.05).name('move threshold');

const camFolder = gui.addFolder('Camera');
camFolder.add(CONFIG.cameraCtl, 'autoZoom').name('auto zoom');
camFolder.add(CONFIG.cameraCtl, 'margin', 1, 2.5, 0.05);
camFolder.add(CONFIG.cameraCtl, 'minDistance', 2, 12, 0.5).name('min dist');
camFolder.add(CONFIG.cameraCtl, 'maxDistance', 6, 40, 0.5).name('max dist');
camFolder.add(CONFIG.cameraCtl, 'depthFollow', 0, 1.5, 0.05).name('depth follow');
camFolder.add(CONFIG.cameraCtl, 'followSmoothTime', 0.05, 1.5, 0.05).name('follow smooth ★');
camFolder.add(CONFIG.cameraCtl, 'leadTime', 0, 1, 0.05).name('lead time');
camFolder.add(CONFIG.cameraCtl, 'baseFov', 25, 80, 1).name('base FOV');
camFolder.add(CONFIG.cameraCtl, 'fovGain', 0, 6, 0.1).name('FOV gain ★');
camFolder.add(CONFIG.cameraCtl, 'fovMaxAdd', 0, 40, 1).name('FOV max add');
camFolder.add(CONFIG.cameraCtl, 'deadzone', 0, 0.3, 0.01).name('deadzone');
camFolder.add(CONFIG.cameraCtl, 'swayAzimuthDeg', 0, 15, 0.5).name('sway °');
camFolder.add(CONFIG.cameraCtl, 'rollMaxDeg', 0, 20, 0.5).name('roll max °');
camFolder.add(CONFIG.cameraCtl, 'shakeAmount', 0, 0.4, 0.01).name('shake');

const qualityFolder = gui.addFolder('Quality');
qualityFolder.add(CONFIG.quality, 'auto').name('auto downgrade');
qualityFolder.add(CONFIG.quality, 'downFps', 20, 58, 1).name('down below fps');
qualityFolder.add(CONFIG.quality, 'upFps', 30, 60, 1).name('up above fps');
qualityFolder.add({ level: 0 }, 'level', { cao: 0, 'vua': 1, thap: 2 })
  .name('force level').onChange((v) => quality.setLevel(Number(v)));

const attractFolder = gui.addFolder('Attract (tu dien)');
attractFolder.add(CONFIG.attract, 'enabled').name('enabled');
attractFolder.add(CONFIG.attract, 'idleSeconds', 3, 60, 1).name('idle sec');
attractFolder.add(CONFIG.attract, 'switchSeconds', 2, 20, 0.5).name('switch sec');

gestureFolder.add({ calib: () => startCalibration() }, 'calib').name('Can lai cu chi (K)');

const bgFolder = gui.addFolder('Background');
bgFolder.add(CONFIG.background, 'enabled').name('particles');
bgFolder.add(CONFIG.background, 'baseDrift', 0, 2, 0.02).name('base drift');

motionFolder.add(CONFIG.motion, 'selfSpin', 0, 6, 0.1).name('self spin');
motionFolder.add(CONFIG.formations, 'burstImpulse', 0, 10, 0.1).name('burst impulse');
motionFolder.add(CONFIG.formations, 'breatheAmount', 0, 0.3, 0.01).name('breathe');
camFolder.add(CONFIG.cameraCtl, 'zoomRate', 0.5, 10, 0.1).name('zoom rate');
camFolder.add(CONFIG.cameraCtl, 'twoHandZoom').name('two-hand zoom');
camFolder.add(CONFIG.cameraCtl, 'twoHandGain', 0.3, 3, 0.05).name('two-hand gain');
camFolder.add(CONFIG.cameraCtl, 'zoomMin', 0.2, 1.5, 0.05).name('zoom min');
camFolder.add(CONFIG.cameraCtl, 'zoomMax', 1, 6, 0.1).name('zoom max');
camFolder.add(CONFIG.cameraCtl, 'wheelStep', 0.02, 0.4, 0.01).name('wheel step');

const swarmFolder = gui.addFolder('Swarm');
swarmFolder.add(CONFIG.swarm, 'count', 10, CONFIG.swarm.maxCount, 1)
  .name('sword count').onChange((n) => {
    swarm.setCount(n);
    trail.reset(swarm.swords, swarm.count);
  });

// ─── Bảng tra cử chỉ ───
// 13 cử chỉ mà không liệt kê ở đâu thì phần lớn coi như không tồn tại với người
// dùng. Cột thế tay dùng đúng ký hiệu của dòng trạng thái để đối chiếu được.
const GESTURE_SHEET = [
  ['||||', 'Vô cực', 'xoè cả bàn tay — mặc định'],
  ['····', 'Chụm cầu · HÃM', 'nắm tay; xoay cổ tay thì cụm quay nhanh'],
  ['||||', 'Tản kín màn hình', 'xoè tay khi đang chụm; vung tay để thoát'],
  ['|···', 'Mũi giáo', 'chỉ ngón trỏ'],
  ['|···+', 'Mũi tên', 'ngón trỏ + ngón cái (chữ L)'],
  ['||··', 'Xoắn kép', 'ngón trỏ + giữa (chữ V)'],
  ['|··|', 'Lốc xoáy', 'ngón trỏ + ngón út'],
  ['|||·', 'Tường kiếm', 'ba ngón'],
  ['···|', 'Dây kiếm', 'chỉ ngón út'],
  ['···|+', 'Vành đai', 'ngón út + ngón cái (shaka)'],
  ['····+', 'Vòm khiên', 'nắm tay, giơ ngón cái'],
  ['kẹp', 'Vòng xoay', 'kẹp ngón cái–trỏ, ba ngón kia xoè (dấu OK)'],
  ['kẹp', 'Xoắn ốc', 'kẹp ngón cái–trỏ, cả bàn nắm lại'],
  ['2 tay', 'Zoom', 'giang ra = xa, chụm lại = gần'],
];

const sheet = document.getElementById('cult-sheet');
document.getElementById('sheet-table').innerHTML = GESTURE_SHEET.map(([pose, name, desc]) => {
  const marks = /^[|·]+\+?$/.test(pose)
    ? [...pose].map((ch) => {
      if (ch === '|') return '<span class="on">|</span>';
      if (ch === '·') return '<span class="off">·</span>';
      return '<span class="on" title="ngón cái">&nbsp;+</span>';
    }).join('')
    : `<span class="off">${pose}</span>`;
  return `<tr><td class="pose">${marks}</td><td class="name">${name}</td><td class="desc">${desc}</td></tr>`;
}).join('');

function toggleSheet(force) {
  sheet.hidden = force !== undefined ? !force : !sheet.hidden;
}

// ─── Căn ngưỡng cử chỉ theo bàn tay thật ───
const calibEl = document.getElementById('cult-calib');
const calibStep = calibEl.querySelector('.calib-step');
const calibLabel = calibEl.querySelector('.calib-label');
const calibHint = calibEl.querySelector('.calib-hint');
const calibBar = calibEl.querySelector('.calib-bar span');
const calibMsg = calibEl.querySelector('.calib-msg');

const calibration = createCalibration({
  config: CONFIG,
  onStatus(s) {
    if (!s) { calibEl.hidden = true; return; }
    calibEl.hidden = false;
    if (s.phase === 'done' || s.phase === 'failed') {
      calibStep.textContent = '';
      calibLabel.textContent = s.phase === 'done' ? 'Xong' : 'Chưa đo được';
      calibHint.textContent = '';
      calibBar.style.width = '100%';
      calibMsg.textContent = s.message || '';
      setTimeout(() => { calibEl.hidden = true; }, 2200);
      return;
    }
    calibStep.textContent = `BƯỚC ${s.index + 1} / ${s.total}`;
    calibLabel.textContent = s.label;
    calibHint.textContent = s.phase === 'ready' ? s.hint : 'Giữ nguyên thế tay…';
    calibBar.style.width = `${Math.min(100, Math.max(0, s.progress * 100))}%`;
    calibMsg.textContent = s.message || '';
  },
});

document.getElementById('calib-cancel').addEventListener('click', () => calibration.cancel());

function startCalibration() {
  if (inputMode !== 'hand') {
    caption.textContent = 'Cần bật camera trước khi căn cử chỉ.';
    return;
  }
  toggleSheet(false);
  calibration.start();
}

// ─── Zoom bằng con lăn chuột / phím ───
// Cử chỉ hai tay là cách chính, nhưng nó đòi cả hai bàn tay phải nằm trong khung
// và nhận diện tay thứ hai kém tin cậy hơn hẳn — nên luôn có đường lui này.
const zoomStep = () => 1 + CONFIG.cameraCtl.wheelStep;

function showZoom(z) {
  caption.textContent = `ZOOM ×${z.toFixed(2)}  ·  con lăn chuột hoặc + / −  ·  0 để về mặc định`;
}

window.addEventListener('wheel', (e) => {
  showZoom(cameraRig.nudgeZoom(e.deltaY > 0 ? zoomStep() : 1 / zoomStep()));
}, { passive: true });

let guiHidden = false;
window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') {
    showZoom(cameraRig.nudgeZoom(1 / zoomStep())); // phóng to = camera lại gần
    return;
  }
  if (e.key === '-' || e.key === '_') {
    showZoom(cameraRig.nudgeZoom(zoomStep()));
    return;
  }
  if (e.key === '0') {
    showZoom(cameraRig.resetZoom());
    return;
  }
  if (e.key === '?' || e.key === '/') { toggleSheet(); return; }
  if (e.key === 'k' || e.key === 'K') { startCalibration(); return; }
  if (e.key === 'Escape') { toggleSheet(false); calibration.cancel(); return; }
  if (e.key === 'h') {
    guiHidden = !guiHidden;
    gui.domElement.style.display = guiHidden ? 'none' : '';
  } else if (e.key === 'c') {
    // Khoá camera về tĩnh — để so sánh lúc chỉnh, và để thấy camera động hơn
    // camera tĩnh đến mức nào.
    const locked = cameraRig.toggleLock();
    caption.textContent = locked
      ? 'CAMERA TĨNH (nhấn C để bật lại camera động)'
      : 'Nhấn H ẩn bảng chỉnh · C khoá camera';
  }
});

const clock = new THREE.Clock();
let elapsed = 0;
function tick(nowMs) {
  const dt = Math.min(clock.getDelta(), 0.033); // kẹp dt — chuyển tab quay lại không bị nhảy khung
  elapsed += dt;
  quality.update(dt);
  const handState = updateInput(dt, nowMs ?? performance.now());

  // Căn cử chỉ chạy đè lên mọi thứ khác: đàn kiếm vẫn bay nhưng không nhận lệnh.
  if (calibration.update(dt, handState)) {
    drift.stop();
  } else {
    // Tự diễn khi không ai điều khiển. "Bận" = thấy tay, hoặc vừa có thao tác
    // chuột/phím trong vài giây gần đây.
    userActiveSince += dt;
    const busy = !!handState?.present || userActiveSince < 1.5;
    const auto = attract.update(dt, busy, attractCenter);
    if (auto.active) {
      handPos.copy(attractCenter);
      drift.stop();
      if (auto.formation) swarm.setFormation(auto.formation);
    }
  }

  // Chạy cả ở chế độ chuột. Đội hình phủ màn hình neo theo khung nhìn nên không
  // được dùng nó để canh khung.
  cameraRig.update(dt, {
    extent: swarm.extent,
    velocity: drift.velocity,
    hand: handState,
    // 'field' va 'wall' neo theo khung nhin nen khong duoc dung de canh khung.
    fitExtent: swarm.formation !== 'field' && swarm.formation !== 'wall',
    burst: swarm.burst,
  });
  background.update(dt, drift.velocity, cameraRig.target);
  swarm.setViewAnchor(cameraRig.target);
  // Camera tự lùi ra vào nên vùng nhìn thấy đổi liên tục; đội hình phủ màn hình
  // cần biết kích thước thật của nó.
  const viewH = viewHeightAtOrigin();
  swarm.setViewSize(viewH * camera.aspect, viewH);
  swarm.update(dt, elapsed, handPos);
  trail.update(swarm.swords, swarm.count, dt, camera.position);
  composer.render();
  requestAnimationFrame(tick);
}
tick();
