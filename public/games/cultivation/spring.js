// spring.js — critically damped spring (công thức SmoothDamp của Unity).
//
// Dùng thay cho lerp: lerp cho chuyển động chết (tốc độ tỉ lệ khoảng cách, tới
// nơi là khựng lại), còn spring giữ quán tính — kiếm bị *kéo* về đích chứ không
// nhảy tới đích.
import * as THREE from 'three';

// Vector tạm dùng chung — hàm này chạy 100 lần mỗi frame, không cấp phát mới.
const entry = new THREE.Vector3();
const originalTarget = new THREE.Vector3();
const clampedTarget = new THREE.Vector3();
const change = new THREE.Vector3();
const temp = new THREE.Vector3();
const towardTarget = new THREE.Vector3();
const pastTarget = new THREE.Vector3();

// Cập nhật tại chỗ cả `position` lẫn `velocity`. maxSpeed kẹp tốc độ để tay
// giật mạnh cũng không bắn kiếm ra khỏi màn hình.
export function smoothDamp(position, target, velocity, smoothTime, dt, maxSpeed) {
  const st = Math.max(smoothTime, 1e-4);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  entry.copy(position);
  originalTarget.copy(target);

  change.subVectors(position, target);
  const maxChange = maxSpeed * st;
  if (change.lengthSq() > maxChange * maxChange) change.setLength(maxChange);
  clampedTarget.subVectors(position, change);

  temp.copy(velocity).addScaledVector(change, omega).multiplyScalar(dt);
  velocity.addScaledVector(temp, -omega).multiplyScalar(exp);
  position.copy(change).add(temp).multiplyScalar(exp).add(clampedTarget);

  // Chặn vọt qua đích: nếu vị trí mới đã nằm bên kia đích so với lúc vào hàm
  // thì ghim thẳng vào đích và triệt tiêu vận tốc.
  towardTarget.subVectors(originalTarget, entry);
  pastTarget.subVectors(position, originalTarget);
  if (towardTarget.dot(pastTarget) > 0) {
    position.copy(originalTarget);
    velocity.set(0, 0, 0);
  }
}
