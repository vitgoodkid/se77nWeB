// control.js — chuyển động của TÂM đội hình và khoảng cách camera.
//
// Mô hình điều khiển là QUÁN TÍNH, không phải bám vị trí: vung tay là truyền
// vận tốc cho đàn kiếm, buông tay ra thì nó bay tiếp, chỉ dừng khi có cử chỉ
// hãm (nắm tay). Hệ quả quan trọng: vị trí tuyệt đối của bàn tay không còn
// quyết định vị trí đàn kiếm, nên tay ra khỏi khung hình cũng không gián đoạn
// gì — đó là lý do chọn mô hình này.
import * as THREE from 'three';

const desiredVel = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();

export function createDrift(config) {
  const velocity = new THREE.Vector3();

  function update(dt, center, { driving, braking, handVelocity }) {
    const c = config.control;

    if (braking) {
      velocity.multiplyScalar(Math.exp(-c.brakeRate * dt));
    } else if (driving) {
      // CHỈ nhận vận tốc của tay, tuyệt đối không kéo tâm về vị trí tay: bàn tay
      // không thể vung mãi một chiều, nó luôn phải dừng lại và thường bị kéo
      // ngược về giữa khung. Có số hạng kéo theo vị trí thì mỗi cú vung đều kết
      // thúc bằng việc đàn kiếm bị giật ngược lại.
      desiredVel.copy(handVelocity).multiplyScalar(c.throwGain);
      const speedBefore = velocity.length();
      // Chỉ giữ nguyên momentum khi tay vung CÙNG CHIỀU với hướng đang bay: tay
      // chậm dần ở cuối cú vung thì không được phanh đàn kiếm. Còn khi người
      // dùng cố ý lái ngược thì phải cho nó giảm tốc rồi đổi chiều thật — bơm
      // lại tốc độ cũ ở đây sẽ khuếch đại cú quay đầu thành một cú bật ngược.
      const sameWay = desiredVel.dot(velocity) > 0;
      velocity.lerp(desiredVel, 1 - Math.exp(-c.steerRate * dt));

      const speedAfter = velocity.length();
      if (sameWay && speedAfter < speedBefore && speedAfter > 1e-4) {
        velocity.multiplyScalar(speedBefore / speedAfter);
      }
    } else {
      // Buông tay: hãm rất nhẹ. glideDamping = 0 nghĩa là bay mãi không dừng.
      velocity.multiplyScalar(Math.exp(-c.glideDamping * dt));
    }

    // Không có biên: không gian vô hạn. Đàn kiếm bay thẳng cho tới khi người
    // dùng vung ngược hoặc nắm tay hãm. Camera bám theo nên nó không bao giờ
    // rơi ra khỏi khung hình.
    center.addScaledVector(velocity, dt);
    return velocity;
  }

  function stop() { velocity.set(0, 0, 0); }

  return { update, stop, velocity };
}

// Camera động. Ba việc: tự canh khung theo đàn kiếm, đổi FOV theo tốc độ, và
// không bao giờ đứng hoàn toàn yên.
//
// Quy tắc quan trọng nhất: camera phải CHẬM HƠN đàn kiếm. Camera bám nhanh hơn
// thì đàn kiếm vĩnh viễn nằm giữa khung, không bao giờ trượt trên màn hình, và
// đó chính là cảm giác "kiếm đứng yên". Ở đây `zoomRate` 2.5 tương đương hằng
// số thời gian 0.4s, gấp hơn 3 lần smoothTime 0.12 của kiếm.
export function createCameraRig(config, camera) {
  // Điểm camera đang ngắm. Không gian vô hạn nên camera phải DỜI theo đàn kiếm,
  // không thể đứng một chỗ mà zoom xa mãi.
  const target = new THREE.Vector3();
  let zoomFactor = 1;
  // Mốc của cử chỉ zoom hai tay, đặt lại mỗi lần tay thứ hai vào khung.
  let refSeparation = 0;
  let refZoom = 1;
  let hasZoomRef = false;
  let distance = config.render.cameraDistance;
  let fov = config.cameraCtl.baseFov;
  let roll = 0;
  let shake = 0;
  let swayTime = 0;
  let locked = false;

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // `fitExtent` = false cho các đội hình neo theo màn hình: kích thước của chúng
  // tính TỪ khung nhìn, nên nếu lại lấy chúng để canh khung thì camera lùi ra
  // làm khung to hơn, đội hình to theo, camera lại lùi tiếp — chạy thẳng tới
  // khoảng cách cực đại.
  function update(dt, { extent, velocity, hand, fitExtent = true, burst = 0 } = {}) {
    const cc = config.cameraCtl;
    swayTime += dt;
    if (burst > 0) shake = Math.max(shake, burst);
    shake = Math.max(0, shake - dt / Math.max(cc.shakeDecay, 1e-3));

    updateTwoHandZoom(dt, hand);

    let needed = config.render.cameraDistance;
    let depthOffset = 0;
    if (cc.autoZoom && extent) {
      if (fitExtent) {
        // Dùng bán kính phân vị 90, KHÔNG dùng max: một thanh lạc đàn mà dùng
        // max thì camera giật lùi cả khung, rất xấu.
        const halfFov = THREE.MathUtils.degToRad(fov) / 2;
        const r = extent.radius90 ?? Math.max(extent.x, extent.y);
        const byHeight = (r * cc.margin) / Math.tan(halfFov);
        const byWidth = (r * cc.margin) / (Math.tan(halfFov) * camera.aspect);
        needed = Math.max(needed, Math.min(byHeight, byWidth));
      }
      // Đàn kiếm bay lại gần (z dương) thì camera lùi ra theo, bay ra xa thì
      // tiến vào — nếu không, bay xa một chút là nhỏ tí, bay gần là tràn màn hình.
      depthOffset = extent.z * cc.depthFollow;
    }

    const wantDistance = THREE.MathUtils.clamp(
      needed * zoomFactor + depthOffset, cc.minDistance, cc.maxDistance);
    // Vùng chết: chỉ đuổi theo khi lệch đủ nhiều, nếu không camera rung liên tục
    // theo dao động thở của đội hình.
    if (Math.abs(wantDistance - distance) > distance * cc.deadzone) {
      const step = (wantDistance - distance) * (1 - Math.exp(-cc.zoomRate * dt));
      distance += clampMagnitude(step, cc.maxDistanceRate * dt);
    }

    const speed = velocity ? velocity.length() : 0;
    const wantFov = locked ? cc.baseFov
      : cc.baseFov + Math.min(speed * cc.fovGain, cc.fovMaxAdd);
    const fovStep = (wantFov - fov) * (1 - Math.exp(-cc.fovRate * dt));
    fov += clampMagnitude(fovStep, cc.maxFovRate * dt);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // Nghiêng theo lực ngang, như máy quay bám xe vào cua.
    const wantRoll = locked ? 0 : THREE.MathUtils.clamp(
      (velocity ? -velocity.x : 0) * cc.rollGain * 0.02,
      -THREE.MathUtils.degToRad(cc.rollMaxDeg),
      THREE.MathUtils.degToRad(cc.rollMaxDeg));
    roll += (wantRoll - roll) * (1 - Math.exp(-3 * dt));

    // Ngắm vào chỗ đàn kiếm SẮP tới, không phải chỗ nó đang ở — đàn kiếm tự
    // nhiên lùi về phía sau khung khi tăng tốc, và tốc độ hiện rõ ra.
    lookTarget.set(extent?.cx ?? 0, extent?.cy ?? 0, (extent?.cz ?? 0) * cc.depthFollow);
    if (velocity) lookTarget.addScaledVector(velocity, cc.leadTime);
    // Camera phải CHẬM HƠN đàn kiếm. Bám nhanh hơn thì đàn kiếm vĩnh viễn nằm
    // giữa khung, không bao giờ trượt trên màn hình — và đó chính là cảm giác
    // "kiếm đứng yên" dù trong code mọi thứ đang chạy.
    target.lerp(lookTarget, 1 - Math.exp(-dt / Math.max(cc.followSmoothTime, 1e-3)));

    placeCamera(cc);
    return distance;
  }

  // Zoom hai tay theo kiểu TƯƠNG ĐỐI, không phải ánh xạ tuyệt đối. Ánh xạ tuyệt
  // đối (khoảng cách hai tay X ứng với mức zoom Y) phụ thuộc vào người dùng ngồi
  // xa camera bao nhiêu và sải tay dài bao nhiêu, nên rất dễ trượt hết dải và
  // thành ra "zoom không ăn". Cách này lấy khoảng cách lúc đưa tay thứ hai vào
  // khung làm mốc, rồi zoom theo TỈ LỆ so với mốc đó — giống pinch-to-zoom trên
  // điện thoại, không cần căn chỉnh gì.
  function updateTwoHandZoom(dt, hand) {
    const cc = config.cameraCtl;
    if (!cc.twoHandZoom || !hand?.twoHands || !(hand.separation > 1e-3)) {
      hasZoomRef = false;
      return;
    }
    if (!hasZoomRef) {
      refSeparation = hand.separation;
      refZoom = zoomFactor;
      hasZoomRef = true;
      return;
    }
    const ratio = hand.separation / refSeparation;
    const wanted = THREE.MathUtils.clamp(
      refZoom * Math.pow(ratio, cc.twoHandGain), cc.zoomMin, cc.zoomMax);
    zoomFactor += (wanted - zoomFactor) * (1 - Math.exp(-cc.zoomRate * dt));
  }

  // Zoom bằng con lăn chuột / phím — luôn dùng được, kể cả khi không có camera.
  function nudgeZoom(multiplier) {
    const cc = config.cameraCtl;
    zoomFactor = THREE.MathUtils.clamp(zoomFactor * multiplier, cc.zoomMin, cc.zoomMax);
    // Cử chỉ hai tay sau đó tiếp tục từ mức này chứ không giật về mốc cũ.
    refZoom = zoomFactor;
    hasZoomRef = false;
    return zoomFactor;
  }

  function resetZoom() {
    zoomFactor = 1;
    refZoom = 1;
    hasZoomRef = false;
    return zoomFactor;
  }

  function placeCamera(cc) {
    let azimuth = 0;
    let elevation = 0;
    if (!locked && !reducedMotion) {
      const w = (Math.PI * 2) / Math.max(cc.swayPeriod, 1e-3);
      azimuth = THREE.MathUtils.degToRad(cc.swayAzimuthDeg) * Math.sin(swayTime * w);
      elevation = THREE.MathUtils.degToRad(cc.swayElevationDeg) * Math.sin(swayTime * w * 0.63 + 1.1);
      if (shake > 0) {
        azimuth += (Math.random() - 0.5) * cc.shakeAmount * shake;
        elevation += (Math.random() - 0.5) * cc.shakeAmount * shake;
      }
    }

    const cosEl = Math.cos(elevation);
    camOffset.set(
      Math.sin(azimuth) * cosEl * distance,
      Math.sin(elevation) * distance + config.render.cameraHeight,
      Math.cos(azimuth) * cosEl * distance,
    );
    camera.position.copy(target).add(camOffset);
    camera.lookAt(target);
    camera.rotateZ(roll);
  }

  return {
    update,
    target,
    nudgeZoom,
    resetZoom,
    get zoomFactor() { return zoomFactor; },
    get distance() { return distance; },
    get fov() { return fov; },
    get locked() { return locked; },
    toggleLock() { locked = !locked; return locked; },
  };
}

function clampMagnitude(v, max) {
  return v > max ? max : (v < -max ? -max : v);
}
