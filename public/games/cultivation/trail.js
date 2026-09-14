// trail.js — Phase 4: vệt sáng bám sau mỗi thanh kiếm.
//
// TOÀN BỘ vệt của 100 thanh nằm trong MỘT BufferGeometry duy nhất: topology
// (mảng index) dựng một lần lúc khởi tạo, mỗi frame chỉ ghi lại mảng vị trí và
// màu. 100 object trail riêng lẻ là chết hiệu năng.
//
// Mỗi thanh giữ một ring buffer vị trí quá khứ. Slot mới nhất được ghi đè mỗi
// frame để đầu vệt bám sát kiếm, chỉ "chốt" sang slot kế tiếp theo chu kỳ thời
// gian cố định — nhờ vậy độ dài vệt tính theo giây, không phụ thuộc tốc độ khung.
import * as THREE from 'three';

const localTip = new THREE.Vector3();
const point = new THREE.Vector3();
const newer = new THREE.Vector3();
const older = new THREE.Vector3();
const dir = new THREE.Vector3();
const viewDir = new THREE.Vector3();
const side = new THREE.Vector3();
const lastSide = new THREE.Vector3(1, 0, 0);

export function createTrail({ maxSwords, tipLocalY, config }) {
  const cfg = config.trail;
  const segments = cfg.maxSegments;
  const vertsPerSword = segments * 2;
  const quadsPerSword = segments - 1;

  const positions = new Float32Array(maxSwords * vertsPerSword * 3);
  const colors = new Float32Array(maxSwords * vertsPerSword * 3);
  const indices = new Uint16Array(maxSwords * quadsPerSword * 6);

  for (let s = 0; s < maxSwords; s++) {
    const vBase = s * vertsPerSword;
    const iBase = s * quadsPerSword * 6;
    for (let k = 0; k < quadsPerSword; k++) {
      const a = vBase + k * 2;
      const o = iBase + k * 6;
      indices[o] = a; indices[o + 1] = a + 1; indices[o + 2] = a + 2;
      indices[o + 3] = a + 1; indices[o + 4] = a + 3; indices[o + 5] = a + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Additive + không ghi depth: vệt tự cộng sáng vào nhau và ăn bloom, không
  // che mất kiếm phía sau.
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: cfg.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  // Lịch sử vị trí: [sword][segment] → xyz, đọc ngược từ `head`.
  const history = new Float32Array(maxSwords * segments * 3);
  const baseColor = new THREE.Color(cfg.color);
  let head = 0;
  let sampleAccum = 0;

  function samplePoint(sword, out) {
    // Lấy một điểm dọc thân kiếm thay vì gốc chuôi — vệt mọc ra từ lưỡi.
    localTip.set(0, tipLocalY * sword.scale * config.trail.tipFactor, 0)
      .applyQuaternion(sword.quaternion);
    return out.copy(sword.position).add(localTip);
  }

  // Nhét toàn bộ lịch sử về đúng vị trí hiện tại — dùng lúc khởi tạo và khi đổi
  // số lượng kiếm, nếu không thanh vừa bật sẽ kéo một vệt từ chỗ cũ.
  function reset(swords, count) {
    for (let i = 0; i < count; i++) {
      samplePoint(swords[i], point);
      for (let k = 0; k < segments; k++) {
        const o = (i * segments + k) * 3;
        history[o] = point.x; history[o + 1] = point.y; history[o + 2] = point.z;
      }
    }
    writeGeometry(swords, count, null);
  }

  function readHistory(i, k, out) {
    const slot = (head - k + segments) % segments;
    const o = (i * segments + slot) * 3;
    return out.set(history[o], history[o + 1], history[o + 2]);
  }

  function writeGeometry(swords, count, cameraPos) {
    const active = Math.min(Math.max(2, Math.round(cfg.length)), segments);

    for (let i = 0; i < count; i++) {
      const vBase = i * vertsPerSword;
      for (let k = 0; k < segments; k++) {
        const t = k / (active - 1);
        // Các đốt ngoài độ dài đang bật bị ghim vào đốt cuối với bề rộng 0 →
        // tam giác suy biến, không thấy gì mà cũng không phải đổi topology.
        const kk = Math.min(k, active - 1);
        readHistory(i, kk, point);

        if (cameraPos) {
          readHistory(i, Math.max(kk - 1, 0), newer);
          readHistory(i, Math.min(kk + 1, active - 1), older);
          dir.subVectors(newer, older);
          viewDir.subVectors(point, cameraPos);
          side.crossVectors(dir, viewDir);
          if (side.lengthSq() > 1e-10) {
            side.normalize();
            lastSide.copy(side);
          } else {
            // Hai mẫu trùng nhau (kiếm đứng yên) — giữ hướng bề ngang cũ để
            // dải không lật mặt.
            side.copy(lastSide);
          }
        } else {
          side.set(0, 0, 0);
        }

        const width = k < active
          ? cfg.width * swords[i].scale * (1 - t)
          : 0;
        const fade = k < active ? Math.pow(1 - t, cfg.fadePower) : 0;

        const o = (vBase + k * 2) * 3;
        positions[o] = point.x + side.x * width;
        positions[o + 1] = point.y + side.y * width;
        positions[o + 2] = point.z + side.z * width;
        positions[o + 3] = point.x - side.x * width;
        positions[o + 4] = point.y - side.y * width;
        positions[o + 5] = point.z - side.z * width;

        const r = baseColor.r * fade, g = baseColor.g * fade, b = baseColor.b * fade;
        colors[o] = r; colors[o + 1] = g; colors[o + 2] = b;
        colors[o + 3] = r; colors[o + 4] = g; colors[o + 5] = b;
      }
    }

    geometry.setDrawRange(0, count * quadsPerSword * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  function update(swords, count, dt, cameraPos) {
    if (!cfg.enabled) { mesh.visible = false; return; }
    mesh.visible = true;
    material.opacity = cfg.opacity;

    sampleAccum += dt;
    if (sampleAccum >= cfg.sampleInterval) {
      sampleAccum %= cfg.sampleInterval;
      head = (head + 1) % segments;
      // Đốt vừa chốt khởi đầu từ chính vị trí hiện tại để không hở một đoạn.
      for (let i = 0; i < count; i++) {
        samplePoint(swords[i], point);
        const o = (i * segments + head) * 3;
        history[o] = point.x; history[o + 1] = point.y; history[o + 2] = point.z;
      }
    }

    // Đầu vệt bám sát kiếm giữa hai lần chốt.
    for (let i = 0; i < count; i++) {
      samplePoint(swords[i], point);
      const o = (i * segments + head) * 3;
      history[o] = point.x; history[o + 1] = point.y; history[o + 2] = point.z;
    }

    writeGeometry(swords, count, cameraPos);
  }

  function setColor(hex) { baseColor.set(hex); }

  return { mesh, update, reset, setColor };
}
