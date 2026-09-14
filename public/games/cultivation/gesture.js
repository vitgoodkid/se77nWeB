// gesture.js — Phase 6: state machine nhỏ chọn đội hình theo cử chỉ tay.
//
//   xoè tay / thả lỏng → 'infinity'  (mặc định: quỹ đạo vô cực)
//   nắm tay            → 'sphere'    (cụm cầu quanh tay; cũng là cử chỉ HÃM)
//   xoè tay khi đang chụm → 'field'   (tản kín màn hình, mũi chĩa hết lên trên)
//   chỉ ngón trỏ       → 'column'    (trụ dài theo hướng ngón trỏ)
//   trỏ + giữa (chữ V) → 'helix'     (xoắn kép, hai sợi quấn quanh trục đứng)
//   trỏ + út           → 'vortex'    (lốc xoáy, tầng dưới quay nhanh hơn tầng trên)
//   ba ngón            → 'wall'      (tường kiếm có sóng chạy ngang)
//   giơ ngón cái       → 'dome'      (vòm khiên chắn trước mặt)
//   chỉ ngón út        → 'chain'     (dây kiếm uốn lượn như rắn)
//   ngón cái + út      → 'rings'     (nhiều vành đai quay ngược chiều nhau)
//   ngón cái + trỏ     → 'arrow'     (mũi tên lớn theo hướng ngón trỏ)
//   kẹp ngón, xoè      → 'ring'      (vòng tròn quay chậm quanh tay)
//   kẹp ngón, nắm      → 'spiral'    (xoắn ốc nhiều nhánh như thiên hà)
//
// Chống nhấp nháy ở vùng ranh giới bằng HAI cơ chế chồng lên nhau: ngưỡng vào
// khác ngưỡng ra (trễ trạng thái), và cử chỉ phải giữ ổn định vài frame mới được
// đổi. Thiếu chúng thì đội hình nhảy loạn mỗi khi tay ở lưng chừng.
export function createGestureClassifier(config) {
  let current = 'infinity';
  let candidate = 'infinity';
  let stable = 0;

  // Đang ở trạng thái đó rồi thì dùng ngưỡng ra (rộng hơn), chưa vào thì dùng
  // ngưỡng vào (chặt hơn).
  function below(value, enter, exit, isActive) {
    return value < (isActive ? exit : enter);
  }

  // Phân loại theo SỐ NGÓN ĐANG DUỖI thay vì theo khoảng cách tới lòng bàn tay.
  // Bản trước đo khoảng cách rồi so ngưỡng tuyệt đối nên phụ thuộc nặng vào tay
  // to nhỏ, xa gần và góc nghiêng — mỗi người phải tự dò lại ngưỡng thì mới
  // chạy. Đếm ngón duỗi thì ngưỡng nằm sẵn ở tầng từng ngón (đã có trễ trạng
  // thái riêng), ở đây chỉ còn logic rời rạc, gần như không phải chỉnh gì.
  function classify(hand, handSpeed) {
    const g = config.gesture;
    const e = hand.extended;

    // Kẹp ngón cái–trỏ. Xét trước vì lúc kẹp thì ngón trỏ vẫn tính là duỗi.
    // Tách hai kiểu kẹp: ba ngón kia duỗi (dấu OK) hay cụp lại (kẹp chặt).
    const pinching = current === 'ring' || current === 'spiral';
    if (below(hand.pinch, g.pinchEnter, g.pinchExit, pinching)) {
      return hand.extendedCount >= 2 ? 'ring' : 'spiral';
    }

    // Không ngón nào duỗi: nắm tay. Chìa thêm ngón cái ra thì thành cử chỉ khác.
    if (hand.extendedCount === 0) return hand.thumbExtended ? 'dome' : 'sphere';

    // Các thế ngón rời rạc — mỗi thế một đội hình. So khớp chính xác từng ngón
    // nên không có vùng chồng lấn nào giữa chúng. Ngón cái đóng vai BỔ NGỮ cho
    // các thế một ngón: nhờ vậy ngưỡng ngón cái (thứ khó căn nhất) chỉ ảnh
    // hưởng tới cử chỉ phụ, không đụng tới thế xoè tay mặc định.
    if (e.index && !e.middle && !e.ring && !e.pinky) {
      return hand.thumbExtended ? 'arrow' : 'column';  // chữ L / chỉ trỏ
    }
    if (!e.index && !e.middle && !e.ring && e.pinky) {
      return hand.thumbExtended ? 'rings' : 'chain';   // shaka / chỉ ngón út
    }
    if (e.index && e.middle && !e.ring && !e.pinky) return 'helix';   // chữ V
    if (e.index && !e.middle && !e.ring && e.pinky) return 'vortex';  // trỏ + út
    if (e.index && e.middle && e.ring && !e.pinky) return 'wall';     // ba ngón

    // Xoè tay: bình thường là quỹ đạo vô cực, NHƯNG nếu đang chụm thì xoè ra
    // nghĩa là tản kín màn hình. Vung tay đi tiếp thì chụm lại như cũ.
    if (current === 'sphere' || current === 'field') {
      return handSpeed > g.scatterExitSpeed ? 'infinity' : 'field';
    }
    return 'infinity';
  }

  return {
    // Trả về đội hình đang có hiệu lực. Mất tay thì giữ nguyên đội hình cuối,
    // không rơi về mặc định — nhấp nháy nhận diện không được đổi đội hình, và
    // tay ra khỏi khung hình cũng phải giữ nguyên cử chỉ đang dùng.
    update(hand, handSpeed = 0) {
      if (!config.gesture.enabled || !hand.present) return current;

      const raw = classify(hand, handSpeed);
      if (raw === candidate) stable++;
      else { candidate = raw; stable = 1; }

      if (candidate !== current && stable >= config.gesture.stableFrames) current = candidate;
      return current;
    },
    get current() { return current; },
    get candidate() { return candidate; },
  };
}
