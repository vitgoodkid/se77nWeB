// sword.js — dựng hình một thanh kiếm hoàn toàn bằng code (procedural), không dùng
// asset/texture ngoài. Gồm 3 phần: pommel + chuôi (CylinderGeometry), chắn tay
// (BoxGeometry), và lưỡi kiếm (BufferGeometry dựng tay để có bề dày thật, không
// phải mặt phẳng). Gộp lại thành MỘT geometry duy nhất — bắt buộc cho instancing
// ở phase 2 — nhưng giữ 2 group vật liệu (kim loại tối / lưỡi phát sáng): nếu cả
// khối dùng chung một emissive thì bloom ăn đều toàn bộ hình, biến kiếm thành một
// vệt sáng mờ mất luôn hình dáng thay vì chỉ lưỡi kiếm phát sáng.
//
// QUY ƯỚC TRỤC: mũi kiếm chỉ theo +Y cục bộ. Gốc toạ độ (0,0,0) đặt ở đáy chuôi
// kiếm (dưới quả pommel). Toàn bộ phần xoay kiếm ở các phase sau phụ thuộc quy
// ước này — không đổi.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildSwordGeometry(cfg) {
  const {
    pommelRadius, hiltLength, hiltRadius,
    guardWidth, guardHeight, guardDepth, guardMidRatio, guardMidPos,
    bladeLength, bladeBaseWidth, bladeBaseDepth, bladeMidRatio, bladeMidPos,
  } = cfg;

  // Pommel — quả cầu nhỏ chặn đáy chuôi.
  const pommel = stripToPositionOnly(new THREE.SphereGeometry(pommelRadius, 10, 8));

  // Chuôi kiếm — trụ tròn, hơi thon về phía pommel.
  let hilt = new THREE.CylinderGeometry(hiltRadius, hiltRadius * 0.85, hiltLength, 10);
  hilt.translate(0, hiltLength / 2, 0);
  hilt = stripToPositionOnly(hilt);

  // Chắn tay — hai gai thuôn nhọn mọc ngược hướng nhau từ tâm, thay cho một
  // khối hộp đầu bằng cụt. Dựng theo +Y rồi xoay ±90° quanh Z: phép xoay giữ
  // nguyên chiều cuốn tam giác nên normal không bị lộn.
  const guardY = hiltLength + guardHeight / 2;
  const guardArm = () => buildTaperedSpike({
    baseY: 0,
    length: guardWidth / 2,
    baseHalfWidth: guardHeight / 2, // sau khi xoay, trục X thành chiều cao chắn tay
    baseHalfDepth: guardDepth / 2,
    midRatio: guardMidRatio,
    midT: guardMidPos,
  });
  const guardRight = guardArm();
  guardRight.rotateZ(-Math.PI / 2);
  guardRight.translate(0, guardY, 0);
  const guardLeft = guardArm();
  guardLeft.rotateZ(Math.PI / 2);
  guardLeft.translate(0, guardY, 0);

  // Lưỡi kiếm — 3 vòng tiết diện hình thoi (đáy → giữa → mũi nhọn), có bề dày
  // thật theo trục Z, thon dần thay vì tuyến tính để trông giống mũi giáo hơn.
  const bladeBaseY = hiltLength + guardHeight;
  const blade = buildTaperedSpike({
    baseY: bladeBaseY,
    length: bladeLength,
    baseHalfWidth: bladeBaseWidth / 2,
    baseHalfDepth: bladeBaseDepth / 2,
    midRatio: bladeMidRatio,
    midT: bladeMidPos,
  });

  // Nhóm 1: pommel+chuôi+chắn tay → gộp trước thành một khối "kim loại tối",
  // nhóm 2: lưỡi kiếm. mergeGeometries(..., true) gán materialIndex theo thứ
  // tự trong mảng đưa vào, nên phải gộp kim loại trước để nó chỉ chiếm 1 slot.
  const metalPart = mergeGeometries([pommel, hilt, guardRight, guardLeft], false);
  const merged = mergeGeometries([metalPart, blade], true);
  merged.computeVertexNormals();
  return merged;
}

// Chuẩn hoá một primitive geometry về "chỉ position, không index" — cùng dạng
// với blade geometry dựng tay bên dưới — để mergeGeometries không kêu lệch
// thuộc tính. Normal thật sẽ được tính lại một lần cho toàn khối sau khi gộp.
function stripToPositionOnly(geo) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.deleteAttribute('normal');
  flat.deleteAttribute('uv');
  return flat;
}

// Một "gai" thuôn nhọn dựng dọc trục +Y: tiết diện hình thoi, đầy nhất ở gốc,
// thu lại ở điểm giữa rồi hội tụ về một mũi nhọn. Dùng chung cho cả lưỡi kiếm
// (dài, thon) lẫn hai cánh chắn tay (ngắn, chỉ nhọn nhẹ).
function buildTaperedSpike({ baseY, length, baseHalfWidth, baseHalfDepth, midRatio, midT }) {
  const midY = baseY + length * midT;
  const tipY = baseY + length;
  const midHalfWidth = baseHalfWidth * midRatio;
  const midHalfDepth = baseHalfDepth * midRatio;

  // Mỗi vòng tiết diện là một hình thoi 4 đỉnh trong mặt phẳng XZ tại độ cao y.
  const ring = (y, hw, hd) => ([
    new THREE.Vector3(hw, y, 0),
    new THREE.Vector3(0, y, hd),
    new THREE.Vector3(-hw, y, 0),
    new THREE.Vector3(0, y, -hd),
  ]);

  const base = ring(baseY, baseHalfWidth, baseHalfDepth);
  const mid = ring(midY, midHalfWidth, midHalfDepth);
  const tip = new THREE.Vector3(0, tipY, 0);

  const positions = [];
  const pushTri = (a, b, c) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  // Đáy lưỡi — mặt bịt kín, nằm ẩn sau chắn tay nên không cần đẹp.
  pushTri(base[0], base[2], base[1]);
  pushTri(base[0], base[3], base[2]);

  // Thân lưỡi: base → mid (4 mặt bên, mỗi mặt 2 tam giác).
  for (let i = 0; i < 4; i++) {
    const a = base[i], b = base[(i + 1) % 4];
    const c = mid[i], d = mid[(i + 1) % 4];
    pushTri(a, b, d);
    pushTri(a, d, c);
  }

  // Mũi nhọn: mid → tip (4 tam giác hội tụ về một điểm).
  for (let i = 0; i < 4; i++) {
    const a = mid[i], b = mid[(i + 1) % 4];
    pushTri(a, b, tip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}
