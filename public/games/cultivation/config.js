// config.js — MỌI con số điều chỉnh cảm giác/hiệu ứng nằm ở đây, không rải rác nơi khác.
// Phase 1: hình kiếm + vật liệu + bloom. Các phase sau (spring, đội hình, tay, trail...)
// sẽ bổ sung thêm khối cấu hình vào đúng file này, không tạo file config thứ hai.
export const CONFIG = {
  render: {
    bgColor: 0x03050a,
    fogDensity: 0.055,
    exposure: 0.95,
    ambientIntensity: 0.18,
    directionalIntensity: 1.1,
    cameraFov: 45,
    cameraDistance: 7,
    cameraHeight: 0.1,
  },
  bloom: {
    threshold: 0.8,
    strength: 0.6,
    radius: 0.22,
  },
  // Phase 2 — đàn kiếm. count đổi được lúc chạy, maxCount là sức chứa
  // InstancedMesh cấp phát một lần từ đầu nên không đổi giữa chừng.
  swarm: {
    count: 100,
    maxCount: 100,
    scaleBase: 0.45,
    scaleJitter: 0.15, // mỗi thanh lệch ngẫu nhiên ±15% — kiếm y hệt nhau trông như bản sao
  },
  // Quỹ đạo vô cực — mô hình vị trí đích. Kiếm chạy liên tục trên đường cong
  // hình số 8, tâm đặt tại vị trí tay, không bao giờ có đích để đứng lại.
  orbit: {
    a: 2.0,              // bán trục lớn: hình số 8 rộng 2a, cao ~0.67a
    baseSpeed: 0.15,     // vòng/giây khi tay đứng yên
    speedGain: 0.05,     // tay càng nhanh, đàn kiếm xoáy càng nhanh
    laneOffset: 0.06,    // tính theo a — hai làn chẵn/lẻ luồn trên/dưới nhau
    laneBraid: true,     // hai làn đổi chỗ 2 lần mỗi vòng → bện thừng thật sự
    maxDelay: 0.35,      // giây, trễ tâm tối đa; đây mới là chỗ tạo độ "lười"
    stretchGain: 0,      // kéo dài hình số 8 theo hướng bay; để 0 vì đội hình
                         // trụ xoắn bên dưới đã lo phần "đang bay"
    swirlAmp: 0.04,      // tính theo a — xoắn phụ quanh đường đi, quá tay là loạn
    swirlFreq: 1.2,
    alignSpeed: 3,       // tốc độ tay mà tại đó trục dài theo hẳn hướng bay
    frameTurnRate: 3,    // tốc độ xoay mặt phẳng quỹ đạo (~0.05/frame ở 60fps)
    restTiltDeg: 20,     // nghiêng mặt phẳng khi nghỉ, để không phẳng lì với màn hình
    breatheAmpDeg: 6,    // dao động rất chậm của pháp tuyến
    breatheFreq: 0.15,
    velocityWindow: 0.05, // cửa sổ lấy tốc độ tay từ lịch sử tâm
    historyCapacity: 180, // ~0.6s kể cả ở màn hình 240Hz
  },
  // Đội hình lúc ĐANG BAY: trụ xoắn thuôn nhọn về phía trước. Kiếm bện thành
  // vài bó quanh trục hướng bay, bán kính co dần về 0 ở mũi.
  //
  // Khác biệt cốt lõi so với hình số 8: độ trễ tâm ở đây TƯƠNG QUAN với vị trí
  // dọc trục — đuôi lấy tâm của quá khứ, mũi lấy tâm hiện tại. Nhờ vậy khối trụ
  // uốn theo đúng đường tay vừa đi mà vẫn là một khối gọn, thay vì mỗi thanh
  // trễ một kiểu rồi tán ra loạn.
  spear: {
    blendSpeed: 1.5,   // tốc độ tay mà tại đó chuyển hẳn sang trụ xoắn
    blendRate: 5,      // tốc độ làm mượt việc chuyển đội hình
    length: 2.2,       // chiều dài trụ, mũi nhô về phía trước tâm
    radius: 0.6,       // bán kính ở đuôi
    taper: 1,          // nắn profile trước khi làm mượt; 1 = smoothstep thuần
    pathFollow: 0.85,  // trục trụ bám theo đường tay đã đi (1 = bám hoàn toàn)
    pathSample: 0.06,  // giây, cửa sổ lấy hướng đi tại mỗi đốt
    twistTurns: 1.0,   // số vòng xoắn của mỗi bó từ mũi về đuôi
    alignToStrand: 0.75, // mức kiếm nằm theo sợi xoắn thay vì theo vận tốc thật
    strands: 3,        // số bó kiếm bện quanh trục
    spinTurns: 1.0,    // số vòng trụ tự xoay mỗi chu kỳ dòng chảy
    delayAlong: 1.0,   // nhân với orbit.maxDelay → độ trễ của đuôi trụ
    axisTurnRate: 8,   // tốc độ trục trụ bám theo hướng tay
  },
  // Phase 3 — chuyển động. Với mô hình quỹ đạo, điểm đích đã tự mượt và tự luôn
  // chuyển động, nên spring chỉ còn nhiệm vụ khử giật nhỏ: smoothTime phải THẤP,
  // để cao là kiếm tụt lại sau đường cong, cắt góc và hình số 8 nhoè thành mây.
  // Muốn kiếm "lười" hơn thì tăng orbit.maxDelay, đừng tăng smoothTime.
  motion: {
    smoothTime: 0.12,  // giây — mục 6 của ORBIT-lemniscate: 0.08–0.15
    stagger: 0.6,      // smoothTime_i = smoothTime * (1 + phase_i * stagger)
    maxSpeed: 14,      // kẹp tốc độ, tay giật mạnh không bắn kiếm ra khỏi màn
    turnRate: 6,       // tốc độ slerp về hướng đích (~0.1/frame ở 60fps)
    aimSpeed: 1.5,     // tốc độ bay mà tại đó mũi kiếm theo hẳn hướng bay
    bankGain: 0.045,   // độ nghiêng theo gia tốc ngang
    bankMaxDeg: 20,
    // Mỗi thanh tự quay quanh trục dọc của nó, tốc độ lệch nhau. Kiếm dẹt nên
    // mặt lưỡi khi xoay sẽ bắt sáng khác nhau → lấp lánh. Đây là nguồn chuyển
    // động nhìn thấy được ngay cả khi thanh kiếm gần như đứng một chỗ.
    selfSpin: 1.1,     // rad/giây, nhân với hệ số riêng từng thanh
  },
  // Nền có vật mốc — ba lớp hạt bụi ở ba độ sâu. Không phải trang trí: nền đen
  // trơn thì không có gì để mắt so sánh, bay nhanh hay chậm nhìn y như nhau.
  // Lớp gần lướt qua khung nhanh gấp nhiều lần lớp xa, đó chính là parallax và
  // là thứ nói cho mắt biết "đang bay".
  background: {
    enabled: true,
    baseDrift: 0.22, // nền vẫn trôi nhẹ khi đàn kiếm đứng yên
    layers: [
      // gần: to, mờ nhạt, lướt nhanh
      { count: 200, z: 3.2, width: 26, height: 15, size: 0.1, opacity: 0.45, parallax: 1.7, color: '#cfe9ff' },
      // giữa: ngang đàn kiếm, rõ nhất, vật mốc chính
      { count: 300, z: 0, width: 32, height: 18, size: 0.062, opacity: 0.34, parallax: 1, color: '#9fd0ff' },
      // xa: nhỏ, rất mờ, gần như đứng yên
      { count: 420, z: -9, width: 52, height: 28, size: 0.05, opacity: 0.2, parallax: 0.3, color: '#7fb4e6' },
    ],
  },
  // Điều khiển theo QUÁN TÍNH, không theo vị trí tuyệt đối của tay: vung tay là
  // truyền vận tốc cho đàn kiếm, buông ra thì nó bay tiếp. Nhờ vậy tay ra khỏi
  // khung hình cũng không sao — vị trí tay không còn là thứ quyết định.
  control: {
    moveThreshold: 0.9,  // tốc độ tay từ mức này trở lên mới coi là đang lái.
                         // Đặt thấp quá thì động tác kéo tay về giữa khung cũng
                         // bị đọc thành lệnh lái ngược.
    steerRate: 8,        // tốc độ tâm nhận vận tốc mới từ tay
    throwGain: 1,        // hệ số truyền vận tốc tay sang đàn kiếm
    glideDamping: 0.12,  // hãm lúc buông tay; để 0 là bay mãi không dừng
    brakeRate: 6,        // tốc độ hãm khi nắm tay (cử chỉ ngừng lại)
  },
  // Camera tự lùi ra khi đàn kiếm vượt khung hình, cộng thêm zoom thủ công bằng
  // khoảng cách hai bàn tay.
  cameraCtl: {
    autoZoom: true,
    minDistance: 5,
    maxDistance: 18,
    margin: 1.3,        // chừa lề quanh đàn kiếm khi tự canh khung
    depthFollow: 0.85,  // camera bám theo độ sâu đàn kiếm (1 = bù hết, mất hẳn
                        // cảm giác xa gần; thấp hơn thì vẫn thấy nó tiến/lùi)
    // Không gian vô hạn nên camera phải DỜI theo đàn kiếm. Quy tắc bắt buộc:
    // followSmoothTime phải LỚN HƠN motion.smoothTime của kiếm (0.12) ít nhất
    // 1.5 lần. Camera bám nhanh hơn kiếm thì đàn kiếm vĩnh viễn nằm giữa khung,
    // không bao giờ trượt trên màn hình — và đó chính là cảm giác "đứng yên".
    followSmoothTime: 0.45,
    // Ngắm vào chỗ đàn kiếm SẮP tới. Phải lớn hơn followSmoothTime thì đàn kiếm
    // mới lùi về phía sau khung khi tăng tốc — đúng ngôn ngữ quay phim hành
    // động, và làm tốc độ hiện rõ. Nhỏ hơn thì nó lại trôi lên phía trước khung.
    leadTime: 0.55,
    zoomRate: 2.5,      // tốc độ camera đổi khoảng cách
    deadzone: 0.08,     // chỉ đổi khoảng cách đích khi lệch quá 8% — không có
                        // cái này thì camera rung liên tục theo nhịp thở đội hình
    maxDistanceRate: 9, // đơn vị/giây, kẹp TỐC ĐỘ đổi chứ không chỉ kẹp giá trị
    // FOV theo tốc độ: khoảng cách và FOV chạy độc lập nên lúc tăng tốc được
    // hiệu ứng dolly-zoom nhẹ — nền giãn ra trong khi đàn kiếm giữ nguyên cỡ.
    baseFov: 45,
    fovGain: 1.6,
    fovMaxAdd: 18,
    fovRate: 6,         // spring FOV nhanh hơn spring khoảng cách
    maxFovRate: 40,     // độ/giây
    // Camera không bao giờ đứng hoàn toàn yên. Nguyên bản addendum cho góc
    // phương vị tăng đều (quay vòng mãi), nhưng ở đây đội hình phủ màn hình và
    // phép chiếu tay đều giả định camera nhìn thẳng, nên đổi thành lắc trong
    // biên độ nhỏ.
    swayAzimuthDeg: 3.5,
    swayElevationDeg: 2.2,
    swayPeriod: 17,     // giây cho một chu kỳ lắc ngang
    rollMaxDeg: 6,      // nghiêng theo vận tốc ngang của đàn
    rollGain: 0.9,
    shakeAmount: 0.11,  // rung khi đổi đội hình
    shakeDecay: 0.25,   // giây
    twoHandZoom: true,
    // Zoom hai tay tính theo TỈ LỆ so với khoảng cách lúc đưa tay thứ hai vào
    // khung, không phải ánh xạ tuyệt đối — nhờ vậy không phụ thuộc bạn ngồi xa
    // camera bao nhiêu hay sải tay dài bao nhiêu.
    twoHandGain: 1.25,  // >1 thì giang tay ra một chút đã zoom nhiều
    zoomMin: 0.45,      // hệ số nhân khoảng cách camera, cận gần nhất
    zoomMax: 3.2,       // …và cận xa nhất
    wheelStep: 0.12,    // mỗi nấc con lăn chuột / phím đổi bấy nhiêu phần
  },
  // Phase 6 — các đội hình khác ngoài mặc định. Toạ độ slot tính bằng công
  // thức, không hard-code.
  formations: {
    blendSeconds: 0.4, // thời gian chuyển giữa hai đội hình
    sphere: { radius: 0.95, spinTurns: 0.35 },
    // Xoè tay khi đang chụm → tản kín màn hình, mũi chĩa hết lên trên.
    field: {
      fill: 0.88,   // phủ bao nhiêu phần vùng nhìn thấy
      jitter: 0.05, // xô lệch khỏi lưới cho đỡ đều như bàn cờ
      depth: 1.2,   // rải theo chiều sâu
      bob: 0.12,    // nhấp nhô nhẹ để không đứng chết
    },
    ring: { radius: 1.3, spinTurns: 1 },
    // Chữ V → xoắn kép quanh trục đứng.
    helix: { radius: 0.85, height: 3.4, turns: 2.2, strands: 2, spinTurns: 0.6 },
    // Trỏ + út → lốc xoáy. `shear` là thứ quan trọng nhất: tầng dưới quay nhanh
    // hơn tầng trên bấy nhiêu lần, để khối luôn bị xoắn trượt.
    vortex: { radiusBottom: 0.25, radiusTop: 1.9, height: 3.6, flare: 1.6, spinTurns: 0.9, shear: 1.6, rise: 0.35 },
    // Ba ngón → tường kiếm có sóng chạy ngang.
    wall: { fill: 0.7, waves: 1.6, waveSpeed: 1.5, waveAmp: 0.45, lean: 1.1, depth: 0.5 },
    // Giơ ngón cái → vòm khiên hướng về phía người xem.
    dome: { radius: 1.7, spinTurns: 0.3 },
    // Chỉ ngón út → dây kiếm uốn lượn như rắn.
    chain: { length: 5, amplitude: 0.75, waves: 1.8, waveSpeed: 2.2 },
    // Ngón cái + út → vành đai đồng tâm quay ngược chiều nhau.
    rings: { count: 4, radius: 0.7, gap: 0.42, spinTurns: 1.1, tiltStep: 0.42 },
    // Ngón cái + trỏ → mũi tên chĩa theo hướng ngón trỏ.
    arrow: { headOffset: 1.5, wingLength: 2.6, spreadDeg: 38, arch: 0.22, pulseFreq: 2.2, pulseAmp: 0.35 },
    // Kẹp chặt → xoắn ốc nhiều nhánh.
    spiral: { arms: 3, turns: 0.85, innerRadius: 0.25, outerRadius: 2.1, thickness: 0.35, spinTurns: 0.55 },
    column: { length: 2.6, radius: 0.45, taper: 1, twistTurns: 1.2, strands: 3, spinTurns: 0.8, delayAlong: 0.6 },
    // Xoay bàn tay khi đang nắm → cụm kiếm quay nhanh theo.
    spinFromHand: 1.4,
    spinBoostMax: 4,
    // Đổi đội hình thì nổ tung ra rồi mới tụ lại: một xung ngắn đẩy toàn bộ ra
    // xa tâm, sau đó spring kéo về đội hình mới. Chuyển cảnh dứt khoát và có
    // lực thay vì trượt nhạt nhoà.
    burstImpulse: 3.4,
    // Thở: bán kính đội hình dao động nhẹ, chu kỳ vài giây.
    breatheAmount: 0.08,
    breathePeriod: 3.5,
  },
  // Ngưỡng nhận cử chỉ. Bàn tay mỗi người một khác nên gần như chắc chắn phải
  // chỉnh lại: mở bảng lil-gui, xem số đo trực tiếp ở góc dưới trái rồi đặt
  // ngưỡng vào/ra ôm quanh giá trị thật của bạn.
  gesture: {
    enabled: true,
    stableFrames: 5,   // cử chỉ phải giữ ổn định bấy nhiêu frame mới đổi đội hình
    pinchEnter: 0.45,  // kẹp ngón cái–trỏ: khoảng cách / kích thước bàn tay
    pinchExit: 0.62,
    scatterExitSpeed: 1.2, // đang tản mà vung tay nhanh hơn mức này thì chụm lại
  },
  // Tự hạ chất lượng khi máy không theo kịp.
  quality: {
    auto: true,
    downFps: 45,      // dưới mức này liên tục thì hạ một bậc
    upFps: 57,        // trên mức này đủ lâu thì nâng lại
    holdSeconds: 2.5, // phải giữ bấy nhiêu giây mới đổi, tránh nhấp nháy
  },
  // Tự diễn khi không có ai điều khiển — phần lớn khách ghé qua sẽ không bật
  // webcam, không có cái này thì họ chỉ thấy một hình đứng im.
  attract: {
    enabled: true,
    idleSeconds: 18,
    switchSeconds: 7,
    pathRadius: 1.6,
  },
  // Phase 5 — nguồn điều khiển từ webcam. Toàn bộ nhận diện chạy trong trình
  // duyệt; không khung hình nào rời khỏi máy.
  hand: {
    numHands: 2, // tay thứ hai chỉ dùng cho cử chỉ zoom
    videoWidth: 640,   // hạ xuống nếu máy yếu — nhận diện tay tốn hơn render nhiều
    videoHeight: 480,
    smoothFrames: 4,   // trung bình trượt landmark, 3–5 là vùng hợp lý
    // Ngưỡng duỗi/co của từng ngón (tỉ số khoảng cách tới cổ tay giữa đầu ngón
    // và khớp giữa). Hai giá trị lệch nhau tạo trễ trạng thái ngay ở mức ngón.
    fingerExtendRatio: 1.15,
    fingerCurlRatio: 1.05,
    // Ngón cái đo riêng bằng khoảng cách tới khớp gốc ngón út.
    thumbExtendSpread: 1.55,
    thumbCurlSpread: 1.35,
    reach: 1.15,       // tầm với: 1 = biên độ tay phủ đúng chiều cao khung nhìn
    baseSize: 0.22,    // kích thước bàn tay coi như "khoảng cách chuẩn"
    depthGain: 6,      // tay to (lại gần) → đàn kiếm tiến về phía người xem
    depthClamp: 2,
    wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
    modelUrl: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  // Phase 4 — vệt sáng. Có lúc tắt đi lại đẹp hơn, nên bật/tắt được.
  trail: {
    enabled: true,
    maxSegments: 16,      // sức chứa, cấp phát một lần
    length: 10,           // số đốt đang dùng
    sampleInterval: 1 / 60, // giây giữa hai lần chốt đốt → độ dài tính theo thời gian
    width: 0.055,
    opacity: 0.28,        // additive cộng dồn rất nhanh khi kiếm chụm lại —
                          // để cao là lấp hết khe tối giữa các sợi bện
    fadePower: 2,         // càng lớn đuôi càng tắt nhanh
    tipFactor: 0.55,      // lấy điểm ở đâu dọc thân kiếm (0 = chuôi, 1 = mũi)
    color: '#7fc9ff',
  },
  sword: {
    geometry: {
      pommelRadius: 0.022,
      hiltLength: 0.15,
      hiltRadius: 0.017,
      guardWidth: 0.2,
      guardHeight: 0.022,
      guardDepth: 0.032,
      guardMidRatio: 0.78, // tiết diện tại điểm giữa cánh chắn tay so với tâm
      guardMidPos: 0.62,   // càng nhỏ thì hai đầu chắn tay càng nhọn dài
      bladeLength: 1.0,
      bladeBaseWidth: 0.06,
      bladeBaseDepth: 0.015,
      bladeMidRatio: 0.55, // tiết diện tại điểm giữa so với đáy — tạo dáng thon dần
      bladeMidPos: 0.62,   // vị trí điểm giữa dọc lưỡi (0 = đáy, 1 = mũi)
    },
    // Vật liệu kim loại tối — pommel + chuôi + chắn tay. Không (hoặc rất ít)
    // emissive để KHÔNG bị bloom ăn vào, tương phản với lưỡi kiếm bên dưới.
    metal: {
      color: 0xcaa24a,
      emissive: '#4a3510',
      emissiveIntensity: 0.9,
      metalness: 0.85,
      roughness: 0.32,
    },
    // Vật liệu lưỡi kiếm — emissive mạnh, đây là phần duy nhất vượt ngưỡng
    // bloom.threshold nên chỉ lưỡi kiếm phát sáng, không lem ra toàn khối.
    blade: {
      color: 0xbfe3ff,
      emissive: '#8fd3ff',
      emissiveIntensity: 1.7,
      metalness: 0.6,
      roughness: 0.15,
    },
  },
};
