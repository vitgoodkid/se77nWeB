// swarm.js — đàn kiếm: InstancedMesh (phase 2) + chuyển động spring (phase 3)
// trên quỹ đạo vô cực (ORBIT-lemniscate).
//
// Mô hình đích: mỗi thanh KHÔNG có điểm đích tĩnh để bay tới rồi đứng. Nó chạy
// liên tục trên một đường cong hình số 8 khép kín, tâm đặt tại vị trí tay. Khi
// tay di chuyển, đường bay thật = quỹ đạo đang chạy + tâm đang trượt, nên tự nó
// thành đường cong đan nhau — không thanh nào bay thẳng được.
import * as THREE from 'three';
import { smoothDamp } from './spring.js';
import { lemniscatePoint } from './lemniscate.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const WORLD_X = new THREE.Vector3(1, 0, 0);
const TANGENT_STEP = 0.004; // bước lấy sai phân để ước lượng tiếp tuyến

// Scratch dùng chung trong vòng lặp 100 thanh mỗi frame — không cấp phát mới.
const curve = { x: 0, y: 0 };
const curveAhead = { x: 0, y: 0 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const target = new THREE.Vector3();
const tangent = new THREE.Vector3();
const spearTarget = new THREE.Vector3();
const spearTangent = new THREE.Vector3();
const prevFormTarget = new THREE.Vector3();
const prevFormTangent = new THREE.Vector3();
const spearProbe = new THREE.Vector3();
const pathBehind = new THREE.Vector3();
const localAxis = new THREE.Vector3();
const localSide = new THREE.Vector3();
const localUp = new THREE.Vector3();
const shapeDir = new THREE.Vector3();
const burstDir = new THREE.Vector3();
const swirlAxis = new THREE.Vector3();
const delayedCenter = new THREE.Vector3();
const handNow = new THREE.Vector3();
const handThen = new THREE.Vector3();
const handVelocity = new THREE.Vector3();
const desiredU = new THREE.Vector3();
const velocityDir = new THREE.Vector3();
const prevVelocity = new THREE.Vector3();
const accel = new THREE.Vector3();
const flightDir = new THREE.Vector3();
const wingAxis = new THREE.Vector3();
const targetQuat = new THREE.Quaternion();
const bankQuat = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const scaleVec = new THREE.Vector3();

export function createSwarm({ geometry, materials, config }) {
  const { maxCount, scaleBase, scaleJitter } = config.swarm;

  const mesh = new THREE.InstancedMesh(geometry, materials, maxCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Đàn kiếm bay rộng hơn bounding sphere của geometry gốc rất nhiều; để
  // frustum culling tự tính sẽ có lúc cả đàn biến mất ở rìa màn hình.
  mesh.frustumCulled = false;

  const swords = [];
  for (let i = 0; i < maxCount; i++) {
    swords.push({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: scaleBase * (1 + (Math.random() * 2 - 1) * scaleJitter),
      phase: Math.random(),
      slotIndex: i,
    });
  }

  // Lịch sử vị trí tâm — mỗi thanh lấy tâm của một thời điểm quá khứ khác nhau.
  const history = createCenterHistory(config.orbit.historyCapacity);

  // Hệ trục cục bộ của mặt phẳng chứa hình số 8.
  const frameU = new THREE.Vector3(1, 0, 0); // trục dài
  const frameV = new THREE.Vector3(0, 1, 0);
  const frameN = new THREE.Vector3(0, 0, 1); // pháp tuyến
  // Hệ trục của trụ xoắn: trục chính bám hướng tay, hai trục vuông góc để quay.
  const spearAxis = new THREE.Vector3(1, 0, 0);
  const spearSide = new THREE.Vector3(0, 1, 0);
  const spearUp = new THREE.Vector3(0, 0, 1);
  // Trục do ngón trỏ chỉ, dùng cho đội hình 'column'. Mặc định hướng lên.
  const pointAxis = new THREE.Vector3(0, 1, 0);
  const pointSide = new THREE.Vector3(1, 0, 0);
  const pointUp = new THREE.Vector3(0, 0, 1);

  const lastCenter = new THREE.Vector3();
  let burst = 0;
  // Hệ số thở, nhân vào bán kính mọi đội hình.
  let breath = 1;
  let globalPhase = 0;
  // Pha quay riêng cho các đội hình tròn/cầu: chạy nhanh hơn globalPhase khi
  // người dùng xoay bàn tay lúc đang nắm.
  let spinPhase = 0;
  let spinBoost = 0;
  let stretch = 1;
  let squash = 1;
  let spearBlend = 0;
  // Biên độ đàn kiếm quanh gốc toạ độ, để camera tự canh khung. `z` là độ sâu
  // trung bình — camera bám theo nó khi đàn kiếm bay xa/lại gần.
  const extent = { x: 0, y: 0, z: 0, radius: 0, radius90: 0, cx: 0, cy: 0, cz: 0 };
  // Neo của các đội hình bám màn hình — camera dời đi thì chúng phải dời theo.
  const viewAnchor = new THREE.Vector3();
  // Mảng khoảng cách tạm để lấy phân vị 90 mà không cấp phát mỗi frame.
  const radii = new Float64Array(maxCount);
  // Kích thước vùng nhìn thấy tại mặt phẳng z = 0, do main.js cập nhật mỗi frame
  // vì camera tự lùi ra vào.
  let viewWidth = 11;
  let viewHeight = 5.8;
  // State machine đội hình: đổi đội hình chỉ là đổi điểm đích, phần chuyển cảnh
  // do hệ spring tự lo — không viết animation chuyển đội hình bằng tay.
  let formation = 'infinity';
  let prevFormation = 'infinity';
  let formationBlend = 1;

  function updateOrbitFrame(dt, time, handSpeed) {
    const o = config.orbit;
    // Tay đứng yên → trục dài về ngang thế giới; tay bay → xoay dần về hướng
    // vận tốc tay, nên hình số 8 tự duỗi dọc theo đường bay.
    desiredU.copy(WORLD_X);
    if (handSpeed > 1e-4) {
      velocityDir.copy(handVelocity).divideScalar(handSpeed);
      desiredU.lerp(velocityDir, THREE.MathUtils.clamp(handSpeed / o.alignSpeed, 0, 1));
    }
    if (desiredU.lengthSq() < 1e-8) desiredU.copy(WORLD_X);
    desiredU.normalize();
    frameU.lerp(desiredU, 1 - Math.exp(-o.frameTurnRate * dt)).normalize();

    // Pháp tuyến: +Z (nhìn thẳng mặt camera) nghiêng quanh trục dài một góc cố
    // định, cộng một dao động rất chậm để mặt phẳng luôn "thở" nhẹ.
    const tiltDeg = o.restTiltDeg + o.breatheAmpDeg * Math.sin(time * o.breatheFreq);
    frameN.set(0, 0, 1).applyAxisAngle(frameU, THREE.MathUtils.degToRad(tiltDeg));
    frameV.crossVectors(frameN, frameU);
  }

  function updateSpearFrame(dt, handSpeed) {
    if (handSpeed > 1e-3) {
      velocityDir.copy(handVelocity).divideScalar(handSpeed);
      spearAxis.lerp(velocityDir, 1 - Math.exp(-config.spear.axisTurnRate * dt)).normalize();
    }
    // Hai trục vuông góc với trục trụ, dùng làm mặt cắt ngang.
    spearSide.set(0, 0, 1).cross(spearAxis);
    if (spearSide.lengthSq() < 1e-6) spearSide.set(0, 1, 0).cross(spearAxis);
    spearSide.normalize();
    spearUp.crossVectors(spearAxis, spearSide).normalize();
  }

  // Profile bán kính của khối thuôn. Dùng smoothstep chứ không dùng q^p:
  // với p < 1 thì đạo hàm tiến ra vô cùng khi q → 0, nghĩa là bán kính lao
  // xuống 0 theo phương thẳng đứng — mũi thành một điểm GÃY chứ không thuôn.
  // smoothstep có đạo hàm bằng 0 ở cả hai đầu nên mũi thuôn mượt và vai cũng
  // không bị gấp khúc.
  function taperedRadius(q, radius, taper) {
    const t = Math.pow(THREE.MathUtils.clamp(q, 0, 1), taper);
    return radius * t * t * (3 - 2 * t);
  }

  // Một điểm trên khối trụ xoắn tại toạ độ dọc trục q (0 = mũi, 1 = đuôi).
  //
  // Trục KHÔNG thẳng: tại mỗi đốt, trục cục bộ lấy theo hướng đi thật của tay ở
  // đúng thời điểm trễ tương ứng. Nhờ vậy khi tay lượn thì cả khối uốn theo
  // đường cong đó thay vì là một cây gậy cứng gắn vào đường cong.
  function spearPointAt(i, q, sp, out) {
    const qc = THREE.MathUtils.clamp(q, 0, 1);
    const radius = taperedRadius(qc, sp.radius * breath, sp.taper);
    const angle = (qc * sp.twistTurns + globalPhase * sp.spinTurns) * TAU
      + ((i % sp.strands) / sp.strands) * TAU;

    const delay = qc * sp.delayAlong * config.orbit.maxDelay;
    history.sample(delay, delayedCenter);
    history.sample(delay + sp.pathSample, pathBehind);

    localAxis.subVectors(delayedCenter, pathBehind);
    if (localAxis.lengthSq() > 1e-8) {
      // Tay đứng yên thì hai mẫu trùng nhau và không có hướng đi nào để bám;
      // pha trộn với trục chính để lúc đó khối vẫn giữ được hình dạng.
      localAxis.normalize().lerp(spearAxis, 1 - sp.pathFollow).normalize();
    } else {
      localAxis.copy(spearAxis);
    }

    localSide.set(0, 0, 1).cross(localAxis);
    if (localSide.lengthSq() < 1e-6) localSide.set(0, 1, 0).cross(localAxis);
    localSide.normalize();
    localUp.crossVectors(localAxis, localSide).normalize();

    return out.copy(localAxis).multiplyScalar((0.5 - qc) * sp.length)
      .addScaledVector(localSide, Math.cos(angle) * radius)
      .addScaledVector(localUp, Math.sin(angle) * radius)
      .add(delayedCenter);
  }

  function computeSpearTarget(i, count, out, outTangent) {
    const sp = config.spear;
    const q = count > 1 ? i / (count - 1) : 0;
    spearPointAt(i, q, sp, out);

    // Hướng kiếm lấy bằng sai phân dọc khối thay vì công thức giải tích: trục
    // đã uốn theo đường đi nên đạo hàm không còn viết gọn được, mà sai phân thì
    // tự đúng với mọi kiểu uốn.
    const h = 0.05;
    const towardTip = q >= h;
    spearPointAt(i, towardTip ? q - h : q + h, sp, spearProbe);
    outTangent.subVectors(spearProbe, out);
    if (!towardTip) outTangent.negate();
    if (outTangent.lengthSq() < 1e-12) outTangent.copy(spearAxis);
    else outTangent.normalize();
  }

  // Điểm đích của thanh i: điểm đang chạy trên đường cong, đặt vào mặt phẳng
  // cục bộ, lệch làn, rồi cộng vào tâm ĐÃ TRỄ của riêng thanh đó.
  function computeLemniscateTarget(i, count, out, outTangent) {
    const o = config.orbit;
    const s = (i / count + globalPhase) % 1;

    lemniscatePoint(s, o.a * breath, curve);
    lemniscatePoint(s + TANGENT_STEP, o.a * breath, curveAhead);

    out.copy(frameU).multiplyScalar(curve.x * stretch)
      .addScaledVector(frameV, curve.y * squash);

    outTangent.copy(frameU).multiplyScalar((curveAhead.x - curve.x) * stretch)
      .addScaledVector(frameV, (curveAhead.y - curve.y) * squash);
    if (outTangent.lengthSq() < 1e-12) outTangent.copy(frameU);
    else outTangent.normalize();

    // Hai làn chẵn/lẻ lệch theo pháp tuyến để luồn trên/dưới nhau ở điểm giao
    // thay vì đâm xuyên. Bật `laneBraid` thì hai làn đổi chỗ hai lần mỗi vòng,
    // thành bện thừng thật sự chứ không phải hai đường song song.
    let laneAmp = o.laneOffset * o.a * (i % 2 === 0 ? 1 : -1);
    if (o.laneBraid) laneAmp *= Math.cos(TAU * s * 2);
    out.addScaledVector(frameN, laneAmp);

    // Trễ theo từng thanh: hoán vị nhân 7 để delay_i KHÔNG tỉ lệ với s_i —
    // nếu tương quan, cả đàn gộp lại thành một sợi dây đơn, mất hết nhiều lớp.
    addDecorrelatedDelay(i, count, out);
  }

  // Đội hình mặc định: hình số 8 khi đứng yên, trụ xoắn khi đang bay, pha trộn
  // theo tốc độ tay.
  function computeInfinityTarget(i, count, out, outTangent) {
    computeLemniscateTarget(i, count, out, outTangent);
    if (spearBlend > 0.001) {
      computeSpearTarget(i, count, spearTarget, spearTangent);
      out.lerp(spearTarget, spearBlend);
      outTangent.lerp(spearTangent, spearBlend);
      if (outTangent.lengthSq() < 1e-8) outTangent.copy(spearTangent);
      outTangent.normalize();
    }
  }

  // Nắm tay → cụm cầu chặt quanh tay, mũi kiếm hướng vào tâm. Xoè ra thì vẫn
  // dùng công thức này nhưng bán kính lớn hơn và mũi quay ra ngoài, thành ra
  // từng thanh tách bạch. Điểm rải bằng Fibonacci sphere: chia đều mặt cầu mà
  // không dồn cục ở hai cực như cách chia theo kinh/vĩ độ.
  function computeShellTarget(i, count, out, outTangent, sp, tipsOutward) {
    const t = (i + 0.5) / count;
    const y = 1 - 2 * t;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * GOLDEN_ANGLE + spinPhase * sp.spinTurns * TAU;

    shapeDir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
    out.copy(shapeDir).multiplyScalar(sp.radius * breath);
    outTangent.copy(shapeDir);
    if (!tipsOutward) outTangent.negate(); // mũi chĩa vào tâm

    addDecorrelatedDelay(i, count, out);
  }

  // Kẹp ngón → vòng tròn quay chậm quanh tay, kiếm nằm theo phương tiếp tuyến
  // nên cả vòng trông như đang đuổi nhau.
  function computeRingTarget(i, count, out, outTangent) {
    const rg = config.formations.ring;
    const angle = (i / count + spinPhase * rg.spinTurns) * TAU;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    out.copy(frameU).multiplyScalar(cos * rg.radius * breath)
      .addScaledVector(frameV, sin * rg.radius * breath);
    outTangent.copy(frameU).multiplyScalar(-sin)
      .addScaledVector(frameV, cos)
      .normalize();

    addDecorrelatedDelay(i, count, out);
  }

  // Chỉ ngón trỏ → trụ dài theo hướng ngón, xoắn nhẹ quanh trục. Cùng công thức
  // với trụ lúc bay, chỉ khác trục: ngón trỏ thay cho vector vận tốc.
  function computeColumnTarget(i, count, out, outTangent) {
    const col = config.formations.column;
    const q = count > 1 ? i / (count - 1) : 0;
    const radius = taperedRadius(q, col.radius * breath, col.taper);
    const angle = (q * col.twistTurns + globalPhase * col.spinTurns) * TAU
      + ((i % col.strands) / col.strands) * TAU;

    out.copy(pointAxis).multiplyScalar((0.5 - q) * col.length)
      .addScaledVector(pointSide, Math.cos(angle) * radius)
      .addScaledVector(pointUp, Math.sin(angle) * radius);

    // Đuôi trụ trễ hơn mũi, giống đội hình lúc bay.
    history.sample(q * col.delayAlong * config.orbit.maxDelay, delayedCenter);
    out.add(delayedCenter);

    outTangent.copy(pointAxis);
  }

  function addDecorrelatedDelay(i, count, out) {
    const delay = (((i * 7) % count) / count) * config.orbit.maxDelay;
    history.sample(delay, delayedCenter);
    out.add(delayedCenter);
  }

  // Tản kín màn hình: lưới đều phủ toàn bộ vùng nhìn thấy, mũi kiếm chĩa hết
  // lên trên như một rừng kiếm cắm đất.
  //
  // Đây là đội hình DUY NHẤT neo vào màn hình chứ không neo vào tay: nếu cộng
  // tâm vào thì tâm trôi đi là cả rừng kiếm trôi ra ngoài khung, hỏng hẳn ý đồ
  // "phủ kín màn hình". Cũng vì vậy nó không dùng cơ chế trễ theo từng thanh.
  function computeFieldTarget(i, count, out, outTangent) {
    const fd = config.formations.field;
    const cols = Math.max(1, Math.round(Math.sqrt(count * Math.max(viewWidth / viewHeight, 0.2))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const u = cols > 1 ? (i % cols) / (cols - 1) : 0.5;
    const v = rows > 1 ? Math.floor(i / cols) / (rows - 1) : 0.5;

    const phase = swords[i].phase;
    const jitterX = (phase - 0.5) * fd.jitter;
    const jitterY = (((phase * 7) % 1) - 0.5) * fd.jitter;

    out.set(
      (u - 0.5 + jitterX) * viewWidth * fd.fill,
      (v - 0.5 + jitterY) * viewHeight * fd.fill,
      (((phase * 13) % 1) - 0.5) * fd.depth,
    );
    // Nhấp nhô rất nhẹ để rừng kiếm không đứng chết như ảnh chụp.
    out.y += Math.sin(spinPhase * TAU + phase * TAU) * fd.bob;
    // Neo vào điểm camera đang ngắm, không phải gốc toạ độ: không gian vô hạn
    // nên gốc toạ độ có thể đã nằm ngoài khung hình từ lâu.
    out.add(viewAnchor);
    outTangent.set(0, 1, 0);
  }

  // Chữ V → xoắn kép: hai sợi quấn ngược pha nhau quanh một trục đứng. Kiếm nằm
  // dọc theo tiếp tuyến đường xoắn nên nhìn ra rõ hai sợi bện.
  function computeHelixTarget(i, count, out, outTangent) {
    const h = config.formations.helix;
    const u = count > 1 ? i / (count - 1) : 0.5;
    const strand = (i % h.strands) / h.strands;
    const angle = (u * h.turns + spinPhase * h.spinTurns + strand) * TAU;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const r = h.radius * breath;

    out.set(cos * r, (u - 0.5) * h.height, sin * r);
    const dAngle = h.turns * TAU;
    outTangent.set(-sin * r * dAngle, h.height, cos * r * dAngle).normalize();
    addDecorrelatedDelay(i, count, out);
  }

  // Trỏ + út → lốc xoáy. Điểm mấu chốt là TỐC ĐỘ QUAY KHÁC NHAU THEO ĐỘ CAO:
  // tầng dưới quay nhanh hơn tầng trên nên khối luôn bị xoắn trượt, không bao
  // giờ trông như một vật thể rắn đang quay.
  function computeVortexTarget(i, count, out, outTangent) {
    const v = config.formations.vortex;
    const u = count > 1 ? i / (count - 1) : 0.5; // 0 = đáy, 1 = đỉnh
    const r = (v.radiusBottom + (v.radiusTop - v.radiusBottom) * Math.pow(u, v.flare)) * breath;
    const omega = v.spinTurns * (1 + v.shear * (1 - u));
    const angle = i * GOLDEN_ANGLE + spinPhase * omega * TAU;
    const cos = Math.cos(angle), sin = Math.sin(angle);

    out.set(cos * r, (u - 0.5) * v.height, sin * r);
    outTangent.set(-sin, v.rise, cos).normalize(); // nằm theo phương tiếp tuyến
    addDecorrelatedDelay(i, count, out);
  }

  // Ba ngón → tường kiếm chắn trước mặt, có sóng chạy ngang. Kiếm nghiêng theo
  // độ dốc của sóng nên sóng nhìn thấy rõ chứ không chỉ là dịch lên xuống.
  function computeWallTarget(i, count, time, out, outTangent) {
    const w = config.formations.wall;
    const cols = Math.max(1, Math.round(Math.sqrt(count * Math.max(viewWidth / viewHeight, 0.2))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const u = cols > 1 ? (i % cols) / (cols - 1) : 0.5;
    const v = rows > 1 ? Math.floor(i / cols) / (rows - 1) : 0.5;

    const phase = u * w.waves * TAU - time * w.waveSpeed;
    out.set(
      (u - 0.5) * viewWidth * w.fill,
      (v - 0.5) * viewHeight * w.fill + Math.sin(phase) * w.waveAmp,
      Math.cos(phase * 0.5) * w.depth,
    ).add(viewAnchor);
    outTangent.set(Math.cos(phase) * w.lean, 1, 0).normalize();
  }

  // Giơ ngón cái → vòm khiên: nửa mặt cầu hướng về phía người xem, mũi kiếm
  // chĩa ra ngoài, quay chậm quanh trục đứng.
  function computeDomeTarget(i, count, out, outTangent) {
    const d = config.formations.dome;
    const t = (i + 0.5) / count;
    // Nửa cầu: y trải từ 0 tới 1 thay vì -1 tới 1.
    const y = 1 - t;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * GOLDEN_ANGLE + spinPhase * d.spinTurns * TAU;

    // Trục vòm hướng về camera (+Z), nên "y" của nửa cầu nằm dọc trục Z.
    shapeDir.set(Math.cos(phi) * ring, Math.sin(phi) * ring, y);
    out.copy(shapeDir).multiplyScalar(d.radius * breath);
    outTangent.copy(shapeDir);
    addDecorrelatedDelay(i, count, out);
  }

  // Chỉ ngón út → dây kiếm uốn lượn: một hàng kiếm nối nhau, có sóng chạy dọc
  // thân nên nhìn như con rắn đang trườn.
  function computeChainTarget(i, count, time, out, outTangent) {
    const ch = config.formations.chain;
    const u = count > 1 ? i / (count - 1) : 0.5;
    const phase = u * ch.waves * TAU - time * ch.waveSpeed;
    const amp = ch.amplitude * breath;

    out.set((u - 0.5) * ch.length, Math.sin(phase) * amp, Math.cos(phase * 0.7) * amp * 0.6);
    // Tiếp tuyến của đường sóng — kiếm nằm dọc thân dây.
    const d = ch.waves * TAU;
    outTangent.set(ch.length, Math.cos(phase) * amp * d, -Math.sin(phase * 0.7) * amp * 0.42 * d)
      .normalize();
    addDecorrelatedDelay(i, count, out);
  }

  // Ngón cái + út → nhiều vành đai đồng tâm, vành kề nhau QUAY NGƯỢC CHIỀU nhau.
  // Chiều quay ngược nhau là thứ đọc ra ngay, hơn hẳn việc chỉ quay cùng chiều
  // ở tốc độ khác nhau.
  function computeRingsTarget(i, count, out, outTangent) {
    const rg = config.formations.rings;
    const ringIndex = i % rg.count;
    const perRing = Math.max(1, Math.ceil(count / rg.count));
    const inRing = Math.floor(i / rg.count);
    const dir = ringIndex % 2 === 0 ? 1 : -1;
    const radius = (rg.radius + ringIndex * rg.gap) * breath;
    const angle = (inRing / perRing) * TAU
      + spinPhase * rg.spinTurns * dir * TAU / (1 + ringIndex * 0.35);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const tilt = ringIndex * rg.tiltStep;

    // Vành nghiêng dần quanh trục X để thấy được chiều sâu.
    const y = sin * radius * Math.cos(tilt);
    const z = sin * radius * Math.sin(tilt);
    out.set(cos * radius, y, z);
    outTangent.set(-sin, cos * Math.cos(tilt), cos * Math.sin(tilt)).normalize();
    addDecorrelatedDelay(i, count, out);
  }

  // Ngón cái + trỏ (chữ L) → mũi tên lớn chĩa theo hướng ngón trỏ, thỉnh thoảng
  // chồm tới trước một nhịp.
  function computeArrowTarget(i, count, time, out, outTangent) {
    const ar = config.formations.arrow;
    const side = i % 2 === 0 ? 1 : -1;
    const perWing = Math.max(1, Math.ceil(count / 2) - 1);
    const s = Math.min(1, Math.floor(i / 2) / perWing);

    // Hai cánh xoè từ mũi về sau, tạo hình chevron.
    const spread = THREE.MathUtils.degToRad(ar.spreadDeg);
    const along = -Math.cos(spread) * s * ar.wingLength;
    const across = side * Math.sin(spread) * s * ar.wingLength;
    const surge = Math.sin(time * ar.pulseFreq) * ar.pulseAmp;

    out.copy(pointAxis).multiplyScalar(ar.headOffset + surge + along)
      .addScaledVector(pointSide, across)
      .addScaledVector(pointUp, Math.sin(s * Math.PI) * ar.arch * side);
    outTangent.copy(pointAxis);
    addDecorrelatedDelay(i, count, out);
  }

  // Kẹp chặt → xoắn ốc nhiều nhánh, quay như một thiên hà nhỏ.
  function computeSpiralTarget(i, count, out, outTangent) {
    const sp = config.formations.spiral;
    const arm = i % sp.arms;
    const u = count > 1 ? Math.floor(i / sp.arms) / Math.max(1, Math.ceil(count / sp.arms) - 1) : 0;
    const theta = u * sp.turns * TAU + (arm / sp.arms) * TAU + spinPhase * sp.spinTurns * TAU;
    const r = (sp.innerRadius + u * (sp.outerRadius - sp.innerRadius)) * breath;
    const cos = Math.cos(theta), sin = Math.sin(theta);

    out.set(cos * r, sin * r, Math.sin(u * Math.PI) * sp.thickness);
    // Tiếp tuyến đường xoắn ốc: phần tiếp tuyến vòng + phần nở bán kính.
    const dr = (sp.outerRadius - sp.innerRadius) * breath;
    const dTheta = sp.turns * TAU;
    outTangent.set(dr * cos - r * sin * dTheta, dr * sin + r * cos * dTheta, 0).normalize();
    addDecorrelatedDelay(i, count, out);
  }

  function computeFormation(id, i, count, time, out, outTangent) {
    if (id === 'sphere') computeShellTarget(i, count, out, outTangent, config.formations.sphere, false);
    else if (id === 'field') computeFieldTarget(i, count, out, outTangent);
    else if (id === 'ring') computeRingTarget(i, count, out, outTangent);
    else if (id === 'column') computeColumnTarget(i, count, out, outTangent);
    else if (id === 'helix') computeHelixTarget(i, count, out, outTangent);
    else if (id === 'vortex') computeVortexTarget(i, count, out, outTangent);
    else if (id === 'wall') computeWallTarget(i, count, time, out, outTangent);
    else if (id === 'dome') computeDomeTarget(i, count, out, outTangent);
    else if (id === 'chain') computeChainTarget(i, count, time, out, outTangent);
    else if (id === 'rings') computeRingsTarget(i, count, out, outTangent);
    else if (id === 'arrow') computeArrowTarget(i, count, time, out, outTangent);
    else if (id === 'spiral') computeSpiralTarget(i, count, out, outTangent);
    else computeInfinityTarget(i, count, out, outTangent);
  }

  // Đích cuối: đội hình hiện tại, pha trộn với đội hình cũ nếu vừa đổi, rồi
  // cộng xoắn phụ quanh đường đi.
  function computeTarget(i, count, time, out, outTangent) {
    const o = config.orbit;
    computeFormation(formation, i, count, time, out, outTangent);

    if (formationBlend < 0.999) {
      computeFormation(prevFormation, i, count, time, prevFormTarget, prevFormTangent);
      out.lerp(prevFormTarget, 1 - formationBlend);
      outTangent.lerp(prevFormTangent, 1 - formationBlend);
      if (outTangent.lengthSq() < 1e-8) outTangent.copy(prevFormTangent);
      outTangent.normalize();
    }

    if (o.swirlAmp > 0) {
      swirlAxis.crossVectors(outTangent, frameN);
      if (swirlAxis.lengthSq() > 1e-8) {
        swirlAxis.normalize();
        const wobble = Math.sin(time * o.swirlFreq + swords[i].phase * TAU);
        out.addScaledVector(swirlAxis, o.swirlAmp * o.a * wobble);
      }
    }
  }

  function setCount(n) {
    mesh.count = Math.min(Math.round(n), maxCount);
  }

  function setFormation(id) {
    if (id === formation) return;
    prevFormation = formation;
    formation = id;
    formationBlend = 0;

    // Nổ tung rồi tụ lại: bơm một xung vận tốc hướng ra xa tâm. Spring lo phần
    // kéo về, nên không cần viết animation chuyển cảnh nào.
    const amp = config.formations.burstImpulse;
    if (amp > 0) {
      for (let i = 0; i < mesh.count; i++) {
        const sword = swords[i];
        burstDir.subVectors(sword.position, lastCenter);
        if (burstDir.lengthSq() < 1e-8) {
          burstDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        }
        burstDir.normalize();
        sword.velocity.addScaledVector(burstDir, amp * (0.7 + sword.phase * 0.6));
      }
      burst = 1;
    }
  }

  // Hướng ngón trỏ trong không gian, dùng làm trục cho đội hình 'column'.
  function setPointDirection(dir) {
    if (dir.lengthSq() < 1e-6) return;
    pointAxis.copy(dir).normalize();
    pointSide.set(0, 0, 1).cross(pointAxis);
    if (pointSide.lengthSq() < 1e-6) pointSide.set(1, 0, 0).cross(pointAxis);
    pointSide.normalize();
    pointUp.crossVectors(pointAxis, pointSide).normalize();
  }

  // Đặt cả đàn thẳng lên quỹ đạo, không bay từ gốc toạ độ ra.
  function snapToOrbit(center) {
    history.reset(center);
    spearBlend = 0;
    handVelocity.set(0, 0, 0);
    updateOrbitFrame(1, 0, 0);
    updateSpearFrame(1, 0);
    for (let i = 0; i < mesh.count; i++) {
      const sword = swords[i];
      computeTarget(i, mesh.count, 0, target, tangent);
      sword.position.copy(target);
      sword.velocity.set(0, 0, 0);
      sword.quaternion.setFromUnitVectors(UP, tangent);
    }
    writeMatrices();
  }

  function writeMatrices() {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0; i < mesh.count; i++) {
      const sword = swords[i];
      scaleVec.setScalar(sword.scale);
      matrix.compose(sword.position, sword.quaternion, scaleVec);
      mesh.setMatrixAt(i, matrix);
      sumX += sword.position.x;
      sumY += sword.position.y;
      sumZ += sword.position.z;
    }
    mesh.instanceMatrix.needsUpdate = true;

    // Không gian vô hạn nên biên độ phải đo QUANH TÂM ĐÀN KIẾM, không phải
    // quanh gốc toạ độ — bay xa khỏi gốc không có nghĩa là đội hình nở ra.
    const n = mesh.count || 1;
    const cx = sumX / n, cy = sumY / n, cz = sumZ / n;
    extent.cx = cx; extent.cy = cy; extent.cz = cz;

    let maxX = 0, maxY = 0, maxR = 0;
    for (let i = 0; i < mesh.count; i++) {
      const p = swords[i].position;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      if (Math.abs(dx) > maxX) maxX = Math.abs(dx);
      if (Math.abs(dy) > maxY) maxY = Math.abs(dy);
      const r = dx * dx + dy * dy + dz * dz;
      radii[i] = r;
      if (r > maxR) maxR = r;
    }
    extent.x = maxX;
    extent.y = maxY;
    extent.z = cz;
    extent.radius = Math.sqrt(maxR);
    // Phân vị 90 thay vì max: một thanh lạc đàn mà dùng max thì camera giật lùi
    // cả khung, rất xấu.
    extent.radius90 = percentileRadius(radii, mesh.count, 0.9);
  }

  function update(dt, time, center) {
    const m = config.motion;
    const o = config.orbit;

    lastCenter.copy(center);
    burst = Math.max(0, burst - dt / 0.25);
    // Bán kính đội hình dao động nhẹ — rẻ mà hiệu quả cao, đội hình đứng im
    // cũng không còn cảm giác chết cứng.
    breath = 1 + config.formations.breatheAmount
      * Math.sin((time / Math.max(config.formations.breathePeriod, 1e-3)) * TAU);

    history.push(center, time);
    // Tốc độ tay lấy từ chính lịch sử tâm — đã mượt sẵn qua vài frame.
    history.sample(0, handNow);
    history.sample(o.velocityWindow, handThen);
    handVelocity.subVectors(handNow, handThen).divideScalar(Math.max(o.velocityWindow, 1e-3));
    const handSpeed = handVelocity.length();

    updateOrbitFrame(dt, time, handSpeed);
    updateSpearFrame(dt, handSpeed);

    // Tay càng nhanh càng nghiêng về đội hình trụ xoắn; làm mượt để không giật
    // đội hình mỗi khi tốc độ tay dao động qua ngưỡng. Dùng smoothstep để vượt
    // nhanh qua vùng lưng chừng — pha trộn nửa vô cực nửa trụ nhìn rất lộn xộn,
    // càng ít thời gian ở đó càng tốt.
    const raw = THREE.MathUtils.clamp(handSpeed / config.spear.blendSpeed, 0, 1);
    const blendTarget = raw * raw * (3 - 2 * raw);

    // Chuyển đội hình: chỉ cần đưa hệ số này từ 0 lên 1, spring lo phần còn lại.
    if (formationBlend < 1) {
      formationBlend = Math.min(1, formationBlend + dt / Math.max(config.formations.blendSeconds, 1e-3));
    }
    spearBlend += (blendTarget - spearBlend) * (1 - Math.exp(-config.spear.blendRate * dt));

    // Tay vung mạnh thì đàn kiếm xoáy nhanh hơn — cảm giác "có lực" từ đây.
    globalPhase = (globalPhase + (o.baseSpeed + handSpeed * o.speedGain) * dt) % 1;
    // Pha quay của cụm cầu/vòng tròn cộng thêm tốc độ xoay cổ tay.
    spinPhase = (spinPhase + (o.baseSpeed + handSpeed * o.speedGain + spinBoost) * dt) % 1;
    // …và hình số 8 bị kéo dài theo hướng bay, bóp lại theo phương vuông góc.
    stretch = 1 + Math.min(handSpeed * o.stretchGain, 0.9);
    squash = 1 / Math.sqrt(stretch);

    const bankMax = THREE.MathUtils.degToRad(m.bankMaxDeg);
    const turnAlpha = 1 - Math.exp(-m.turnRate * dt);

    for (let i = 0; i < mesh.count; i++) {
      const sword = swords[i];
      computeTarget(i, mesh.count, time, target, tangent);

      // Spring giờ chỉ còn khử giật nhỏ — độ trễ và cái hồn của chuyển động đến
      // từ delay_i ở trên, không phải từ smoothTime.
      const smoothTime = m.smoothTime * (1 + sword.phase * m.stagger);
      prevVelocity.copy(sword.velocity);
      smoothDamp(sword.position, target, sword.velocity, smoothTime, dt, m.maxSpeed);

      // Hướng mũi kiếm: theo vector vận tốc thật; khi gần đứng yên thì về tiếp
      // tuyến quỹ đạo (hướng nó sắp đi tới).
      // Càng vào đội hình trụ thì hướng kiếm càng theo sợi xoắn thay vì theo
      // vận tốc thật — nếu để vận tốc thắng, cả trăm thanh song song cùng một
      // hướng và không còn nhìn ra bó nào bện với bó nào.
      const speed = sword.velocity.length();
      flightDir.copy(tangent);
      if (speed > 1e-4) {
        velocityDir.copy(sword.velocity).divideScalar(speed);
        const aim = THREE.MathUtils.clamp(speed / m.aimSpeed, 0, 1)
          * (1 - spearBlend * config.spear.alignToStrand);
        flightDir.lerp(velocityDir, aim);
      }
      if (flightDir.lengthSq() < 1e-8) flightDir.copy(tangent);
      flightDir.normalize();
      targetQuat.setFromUnitVectors(UP, flightDir);

      // Nghiêng khi đổi hướng: xoay quanh chính thân kiếm theo gia tốc ngang.
      accel.subVectors(sword.velocity, prevVelocity).divideScalar(dt);
      wingAxis.crossVectors(flightDir, UP);
      let bank = 0;
      if (wingAxis.lengthSq() > 1e-6) {
        wingAxis.normalize();
        bank = THREE.MathUtils.clamp(accel.dot(wingAxis) * m.bankGain, -bankMax, bankMax);
      }
      // Cộng luôn góc tự xoay quanh thân vào cùng một phép quay: cả hai đều
      // quay quanh trục lưỡi kiếm nên chỉ là cộng góc.
      const selfRoll = time * m.selfSpin * (0.45 + sword.phase);
      bankQuat.setFromAxisAngle(flightDir, bank + selfRoll);
      targetQuat.premultiply(bankQuat);

      sword.quaternion.slerp(targetQuat, turnAlpha);
    }

    writeMatrices();
  }

  function setViewSize(w, h) { viewWidth = w; viewHeight = h; }
  function setViewAnchor(v) { viewAnchor.copy(v); }

  // Tốc độ quay thêm (vòng/giây) do người dùng xoay bàn tay.
  function setSpinBoost(v) {
    spinBoost = THREE.MathUtils.clamp(v, -config.formations.spinBoostMax, config.formations.spinBoostMax);
  }

  return {
    mesh, swords, update, setCount, snapToOrbit, setFormation, setPointDirection, setSpinBoost,
    setViewSize, setViewAnchor, extent,
    get count() { return mesh.count; },
    get formation() { return formation; },
    get burst() { return burst; },
    get swarmVelocity() { return handVelocity; },
  };
}

// Phân vị của mảng bình phương khoảng cách. Sắp xếp 100 số mỗi frame là rẻ hơn
// nhiều so với việc phải giữ một cấu trúc dữ liệu riêng.
const sortScratch = [];
function percentileRadius(squared, count, p) {
  if (!count) return 0;
  sortScratch.length = count;
  for (let i = 0; i < count; i++) sortScratch[i] = squared[i];
  sortScratch.sort((a, b) => a - b);
  const idx = Math.min(count - 1, Math.floor(p * (count - 1)));
  return Math.sqrt(sortScratch[idx]);
}

// Ring buffer lịch sử vị trí tâm, ghi mỗi frame. sample(delay) nội suy tuyến
// tính giữa hai mẫu gần thời điểm (hiện tại - delay) nhất.
function createCenterHistory(capacity) {
  const pos = new Float32Array(capacity * 3);
  const times = new Float32Array(capacity);
  let head = -1;
  let size = 0;

  function push(v, time) {
    head = (head + 1) % capacity;
    pos[head * 3] = v.x;
    pos[head * 3 + 1] = v.y;
    pos[head * 3 + 2] = v.z;
    times[head] = time;
    if (size < capacity) size++;
  }

  function reset(v) {
    head = -1;
    size = 0;
    push(v, 0);
  }

  function readInto(idx, out) {
    return out.set(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]);
  }

  function sample(delay, out) {
    if (size === 0) return out.set(0, 0, 0);
    const targetTime = times[head] - delay;

    let newer = head;
    for (let k = 0; k < size - 1; k++) {
      const older = (newer - 1 + capacity) % capacity;
      if (times[older] <= targetTime) {
        const span = times[newer] - times[older];
        const f = span > 1e-6 ? (targetTime - times[older]) / span : 1;
        out.set(
          pos[older * 3] + (pos[newer * 3] - pos[older * 3]) * f,
          pos[older * 3 + 1] + (pos[newer * 3 + 1] - pos[older * 3 + 1]) * f,
          pos[older * 3 + 2] + (pos[newer * 3 + 2] - pos[older * 3 + 2]) * f,
        );
        return out;
      }
      newer = older;
    }
    // Quá khứ xa hơn những gì buffer giữ được → lấy mẫu cũ nhất.
    return readInto((head - (size - 1) + capacity) % capacity, out);
  }

  return { push, sample, reset };
}
