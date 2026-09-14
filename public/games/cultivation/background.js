// background.js — ba lớp hạt bụi phát sáng ở ba độ sâu khác nhau.
//
// Đây KHÔNG phải trang trí. Người xem không cảm nhận được toạ độ, chỉ cảm nhận
// được sự thay đổi trên màn hình; nền đen trơn thì không có vật mốc nào để so
// sánh, đàn kiếm bay nhanh hay chậm nhìn y hệt nhau. Lớp gần trôi qua khung
// nhanh gấp nhiều lần lớp xa — chênh lệch đó (parallax) mới là thứ nói cho mắt
// biết "đang bay".
//
// Hạt trôi ra khỏi hộp thì sinh lại ở phía đối diện, số lượng luôn cố định.
import * as THREE from 'three';

const scroll = new THREE.Vector3();

// Điểm của PointsMaterial mặc định là một ô VUÔNG đặc — nhìn ra pixel lỗi chứ
// không ra hạt bụi. Vẽ sẵn một chấm tròn mờ dần bằng canvas (dựng bằng code,
// không tải asset ngoài) rồi dùng làm map cho cả ba lớp.
let dotTexture = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  dotTexture = new THREE.CanvasTexture(canvas);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

export function createBackground(config) {
  const group = new THREE.Group();
  group.frustumCulled = false;
  const layers = config.background.layers.map(createLayer);
  for (const layer of layers) group.add(layer.points);

  // Đàn kiếm bay sang phải thì nền phải chạy sang trái, và lớp gần chạy nhanh
  // hơn lớp xa — đó là toàn bộ hiệu ứng.
  function update(dt, swarmVelocity, anchor) {
    group.visible = config.background.enabled;
    if (!group.visible) return;

    // Không gian vô hạn: hộp hạt phải đi theo điểm camera ngắm, nếu không bay
    // một lúc là ra khỏi vùng có hạt và nền trống trơn. Hạt vẫn trôi TRONG hộp
    // theo vận tốc đàn kiếm, nên chuyển động biểu kiến trên màn hình không đổi.
    if (anchor) group.position.set(anchor.x, anchor.y, 0);

    scroll.copy(swarmVelocity).multiplyScalar(-1);
    scroll.x -= config.background.baseDrift;

    for (const layer of layers) update1(layer, dt, scroll);
  }

  return { group, update };
}

function createLayer(cfg) {
  const positions = new Float32Array(cfg.count * 3);
  for (let i = 0; i < cfg.count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * cfg.width;
    positions[i * 3 + 1] = (Math.random() - 0.5) * cfg.height;
    positions[i * 3 + 2] = cfg.z + (Math.random() - 0.5) * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(cfg.color),
    size: cfg.size,
    sizeAttenuation: true,
    map: getDotTexture(),
    alphaTest: 0.01,
    transparent: true,
    opacity: cfg.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, positions, cfg, geometry };
}

function update1(layer, dt, scrollVel) {
  const { positions, cfg } = layer;
  const halfW = cfg.width / 2;
  const halfH = cfg.height / 2;
  const dx = scrollVel.x * cfg.parallax * dt;
  const dy = scrollVel.y * cfg.parallax * dt;

  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i] + dx;
    let y = positions[i + 1] + dy;
    // Wrap: ra khỏi hộp thì vòng sang mép đối diện, giữ nguyên số hạt.
    if (x > halfW) x -= cfg.width; else if (x < -halfW) x += cfg.width;
    if (y > halfH) y -= cfg.height; else if (y < -halfH) y += cfg.height;
    positions[i] = x;
    positions[i + 1] = y;
  }
  layer.geometry.attributes.position.needsUpdate = true;
}
