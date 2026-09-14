// attract.js — chế độ tự diễn khi không có ai điều khiển.
//
// Đây là trang cá nhân: phần lớn người ghé qua sẽ KHÔNG bật webcam. Không có
// chế độ này thì thứ họ thấy là một hình vô cực đứng im giữa màn đen rồi thoát.
// Không thấy tay (hoặc không đụng chuột) quá `idleSeconds` thì đàn kiếm tự bay
// theo một quỹ đạo dựng sẵn và tự đổi đội hình.
//
// Bất kỳ thao tác nào của người dùng cũng cắt ngay lập tức.

const CYCLE = ['infinity', 'vortex', 'helix', 'spiral', 'rings', 'sphere', 'field', 'dome', 'chain', 'wall'];

export function createAttract(config) {
  let idle = 0;
  let active = false;
  let time = 0;
  let sinceSwitch = 0;
  let index = 0;

  // Quỹ đạo Lissajous: hai tần số không chia hết cho nhau nên đường đi không
  // bao giờ lặp lại đúng như cũ trong thời gian ngắn.
  function path(out) {
    const a = config.attract.pathRadius;
    out.set(
      Math.sin(time * 0.23) * a * 1.6,
      Math.sin(time * 0.31 + 1.1) * a * 0.75,
      Math.sin(time * 0.17 + 2.3) * a * 0.35,
    );
    return out;
  }

  // `busy` = người dùng đang thao tác (thấy tay, rê chuột, bấm phím).
  function update(dt, busy, center) {
    if (busy) {
      idle = 0;
      if (active) { active = false; return { active: false, justStopped: true }; }
      return { active: false };
    }

    idle += dt;
    if (!config.attract.enabled || idle < config.attract.idleSeconds) {
      return { active: false };
    }

    if (!active) {
      active = true;
      sinceSwitch = config.attract.switchSeconds; // đổi đội hình ngay khi vào
    }

    time += dt;
    sinceSwitch += dt;
    let formation = null;
    if (sinceSwitch >= config.attract.switchSeconds) {
      sinceSwitch = 0;
      formation = CYCLE[index % CYCLE.length];
      index++;
    }

    path(center);
    return { active: true, formation };
  }

  return {
    update,
    get active() { return active; },
    get idle() { return idle; },
  };
}

export const ATTRACT_CYCLE = CYCLE;
