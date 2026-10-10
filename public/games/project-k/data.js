// Project K — game design data. Everything the page shows comes from here.
// Audited 2026-10-10 from the current Unity source, serialized assets and probes.
window.WN = {
  updated: '2026-10-10',
  meta: {
    title: 'PROJECT K',
    tagline: 'Action RPG góc nhìn thứ ba: chiến đấu kiểu Souls/Sekiro, hệ đồ và build kiểu Path of Exile 2.',
    pitch: 'Không có class. Vũ khí đang cầm quyết định cách đánh, ngọc skill quyết định phép, trang bị + chế tạo + cây passive quyết định build. Đánh boss khó bằng lăn né, đỡ, deflect và quản lý thế; Willowmere là làng mở hiện tại, còn Rift mở các thế giới theo quest và Rift Stone.',
    engine: 'Unity 6000.6 · URP · Input System · Cinemachine 3',
    platform: 'PC (Windows)',
    hero: 'img/castle-great-hall.jpg',
  },

  stats: [
    {
      "n": 73,
      "label": "Vũ khí đang dùng / 347 catalog"
    },
    {
      "n": 233,
      "label": "Mảnh trang bị Sidekick"
    },
    {
      "n": 36,
      "label": "Skill trong Resources"
    },
    {
      "n": 33,
      "label": "Support gem"
    },
    {
      "n": 41,
      "label": "Prefab quái"
    },
    {
      "n": 18,
      "label": "Quest có dữ liệu"
    },
    {
      "n": 7,
      "label": "Thế giới Rift khai báo"
    },
    {
      "n": 5,
      "label": "Scene trong Build Settings"
    }
  ],

  pillars: [
    {
      "icon": "⚔",
      "title": "Chiến đấu đọc nhịp",
      "text": "Lăn bất tử, lùi né, đỡ tốn stamina, deflect 12 frame kiểu Sekiro. Thế (Poise) về 0 gây khựng; đang sprint dính đòn có thể ngã."
    },
    {
      "icon": "◆",
      "title": "Loot có ý nghĩa",
      "text": "4 độ hiếm Normal / Magic / Rare / Unique, dòng chỉ số theo tier, 8 gem chế tạo và nâng cấp +10 có rủi ro; boss có cơ chế chống xui khi rơi độc nhất."
    },
    {
      "icon": "✦",
      "title": "Build không class",
      "text": "5 thuộc tính có tác dụng chiến đấu, cây passive 6 nhánh với socket rune và 19 định nghĩa keystone; 6 ô ngọc skill có support lắp bên trong."
    },
    {
      "icon": "⌂",
      "title": "Làng & Rift",
      "text": "Willowmere có các trạm dịch vụ và Runereader. Sunscar mở theo quest; Rift có chuyến cốt truyện và chuyến dùng Rift Stone. Trang trại còn code, chưa gắn vào làng hiện tại."
    }
  ],

  loop: [
    "Willowmere / Sunscar / Rift",
    "Hạ quái & boss, làm quest",
    "Rơi đồ, gem, nguyên liệu",
    "Về làng: rèn, chế, đổi build",
    "Mở thế giới Rift",
    "Thử vùng / boss khó hơn"
  ],

  categories: [
    { id: 'combat', label: 'Chiến đấu', color: '#e0524f' },
    { id: 'weapons', label: 'Vũ khí', color: '#e5b85c' },
    { id: 'items', label: 'Đồ & chế tạo', color: '#b77cff' },
    { id: 'character', label: 'Nhân vật', color: '#5fc28a' },
    { id: 'enemies', label: 'Kẻ địch', color: '#ff8a3d' },
    { id: 'world', label: 'Thế giới', color: '#5aa9e6' },
    { id: 'ui', label: 'Giao diện', color: '#d9c7a4' },
    { id: 'av', label: 'Âm thanh & FX', color: '#f07fbf' },
    { id: 'tech', label: 'Công cụ & kỹ thuật', color: '#8fa3b8' },
    { id: 'story', label: 'Cốt truyện & quest', color: '#7fd1c7' },
  ],

  // Progress is not stored here: the page counts only the items marked Done in the browser (systems + roadmap items).
  systems: [
    {
      "id": "story",
      "cat": "story",
      "name": "Cốt truyện: Burn the World Tree",
      "summary": "18 quest và 142 nút hội thoại có dữ liệu; QuestLog, Dialogue, nhật ký J và lưu tiến độ đã có code. Khung 10 chương + chương cuối và 3 kết thúc chưa hoàn tất.",
      "details": [
        "Burn the World Tree: Aelvar, the Everroot hút cạn hành tinh Eryth; Cold Ember và phe Seedbound là trục cốt truyện.",
        "Resources/Story có Prologue, Chapters, Chapter3 và Willowmere; gồm 18 quest, 142 hội thoại, 19 NPC và hướng dẫn ngọc GemTutorial.",
        "Các thế giới chính đã khai báo: The Broken Stone Forest (Hollow Slayer), The Chained Abyss (Ashmaw), The Orchard of Ash (Sister Verdane).",
        "QuestLog xử lý Talk, Kill, Collect, Give, Boss, Event; lưu chapter, bước nhiệm vụ và story flags. J mở nhật ký; HUD có tracker/banner.",
        "Hội thoại có lựa chọn và điều kiện; chữ nguồn tiếng Anh, Loc/LText dịch khi hiển thị.",
        "Chương 4 trở đi và Ashfall / The Seed / New Ember là kế hoạch nội dung; chưa gọi là chiến dịch hoàn chỉnh."
      ],
      "numbers": [
        [
          "Quest",
          "18"
        ],
        [
          "Hội thoại",
          "142"
        ],
        [
          "NPC trong dữ liệu",
          "19"
        ]
      ],
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Story/StoryBook.cs",
        "Assets/_Game/Scripts/Runtime/Story/QuestLog.cs",
        "Assets/_Game/Scripts/Runtime/Story/Dialogue.cs"
      ]
    },
    {
      "id": "movement",
      "cat": "combat",
      "name": "Di chuyển & né",
      "summary": "State machine tự viết, animator chỉ là máy phát clip. Lăn, lùi né, nhảy, ngồi và chỉnh tốc độ theo vận tốc thật; leo tường vẫn là phần chưa xác nhận trong build hiện tại.",
      "details": [
        "Lăn bất tử trong 0–85% động tác, lùi né 0–60%. Shift chạm = né, giữ = chạy nhanh.",
        "Nhảy: chạm đất khi đang giữ hướng thì vào thẳng chạy, giữ nguyên tốc độ; Space lúc trên không được nhớ 0.2 s → bunny hop (8 cú / 5 s).",
        "Tốc độ animation theo tốc độ thật (nội suy đi / chạy / chạy nhanh) để chân không trượt.",
        "Leo tường có code/probe cũ nhưng chưa nằm trong phạm vi kiểm chứng của bản Sidekick hiện tại.",
        "Ngồi (Ctrl), chui dưới xà.",
        "Đế giày chạm đúng mặt đất (trước lơ lửng ~4 cm ở mọi scene); giày tăng tốc không còn làm lock-on chạy ngang phát clip chạy thẳng."
      ],
      "numbers": [
        [
          "I-frame lăn",
          "0 – 0.85"
        ],
        [
          "I-frame lùi né",
          "0 – 0.6"
        ],
        [
          "Nhớ phím nhảy",
          "0.2 s"
        ],
        [
          "Tiếp đất đứng yên",
          "≤ 0.3 s"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Player/PlayerController.cs"
      ]
    },
    {
      "id": "defense",
      "cat": "combat",
      "name": "Phòng thủ: đỡ & deflect",
      "summary": "Chuột phải đỡ; bấm đúng nhịp là deflect kiểu Sekiro, không tốn stamina.",
      "details": [
        "Cửa sổ deflect 12 frame mở ngay khi bấm; spam liên tục rút còn 4 frame.",
        "Stamina kiểu Elden Ring: còn > 0 là ra đòn được.",
        "Đòn quái trừ Poise theo sát thương thô; về 0 thì khựng. Đòn quyết định của boss vẫn khựng; đang sprint dính đòn thì KnockDown.",
        "Agility có cơ hội né theo Agility/(Agility + Accuracy), trần 75%; sau đó Armour, kháng, Spellguard rồi Life.",
        "Bình máu theo tier hồi 35/40/45/50% Life trong 2 s sau animation uống; quality và affix có thể thay đổi lượng hồi.",
        "Đang giữ đỡ thì đứng yên — đó là tính năng (chốt 03/10), không làm đi khi đỡ.",
        "Mọi vũ khí cận chiến (song kiếm, kiếm, katana, đại kiếm, thương) đỡ cùng một tư thế: hạ người, kiếm chéo trên đầu (người dùng chọn 04/10)."
      ],
      "numbers": [
        [
          "Deflect",
          "12 → 4 frame"
        ],
        [
          "Bình máu gốc",
          "35–50% / 2 s"
        ],
        [
          "Poise nền",
          "100 + 2·END"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Combat/PlayerDefense.cs",
        "Assets/_Game/Scripts/Runtime/Items/Flasks.cs"
      ]
    },
    {
      "id": "lockon",
      "cat": "combat",
      "name": "Lock-on & camera",
      "summary": "Lock kiểu Elden Ring: tầm 20 m, nhả 30 m; hất chuột đổi mục tiêu hoặc điểm khoá, camera tự giữ góc.",
      "details": [
        "Lock trong 20 m (đo tới mép thân mục tiêu), nhả ở 30 m; cần tầm nhìn; camera có xử lý tránh xuyên tường.",
        "Không có mục tiêu → camera quay về sau lưng 0.3 s.",
        "Đổi mục tiêu bằng một cú hất ≥260 px, nghỉ 0.12 s giữa hai lần; hất dọc đổi điểm khoá đầu/ngực/hông.",
        "Khi lock camera giữ góc kiểu Elden Ring, không còn dùng chuột dọc để nghiêng orbit tự do.",
        "Auto Target: mục tiêu chết thì chuyển sang kẻ địch gần nhất.",
        "Zoom camera kiểu Genshin bằng con lăn (0.3 – 1.6 lần khoảng cách gốc).",
        "Khi lock mọi đòn bám mục tiêu."
      ],
      "numbers": [
        [
          "Tầm lock",
          "20 m"
        ],
        [
          "Nhả lock",
          "30 m"
        ],
        [
          "Hất chuột",
          "260 px / nghỉ 0.12 s"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Camera/LockOnController.cs",
        "Assets/_Game/Scripts/Runtime/Camera/LockOnAimExtension.cs"
      ]
    },
    {
      "id": "movesets",
      "cat": "weapons",
      "name": "Bộ đòn theo vũ khí",
      "summary": "6 nhóm moveset đang dùng; chuỗi đã được chỉnh theo tốc độ pack và model Sidekick. Nhiều loại trong catalog vẫn retired hoặc chưa có bộ đòn.",
      "details": [
        "Song kiếm (2 kiếm một tay), Kiếm một tay, Đại kiếm, Katana / Trường kiếm, Cung, Thương / Kích / Glaive.",
        "Mỗi bộ: chuỗi đòn nhẹ, đòn nặng (Shift + chuột trái) + follow-up, đòn chạy, đòn sau né, nhảy chém, chém trên không, phản đòn, kết liễu, đòn tụ lực.",
        "Đòn nhiều nhát: mỗi nhát có tiếng và được trúng lại. Cửa sổ hitbox đo từ tốc độ mũi kiếm.",
        "Cung: combo tự bám mục tiêu (9 tên cho 1 chuỗi), chuột phải ngắm qua vai, tên bay có trọng lực, hết tên thì đập bằng cung.",
        "Chém khi đang nhảy: lao xuống theo hướng nhảy rồi bổ khi chạm đất, trượt tiếp theo đà (mọi vũ khí, kể cả song kiếm).",
        "Thương đã làm lại thành chuỗi 5 bước (02_01 → 02_02 → 02_03 → 03_01 → 03_02), có buffer nối đòn và BladeLevel cho bước cần giữ ngang.",
        "Song kiếm chỉ còn combo 01 bốn nhát và chậm 20%; katana dùng combo 05 chậm 30%; mọi AttackDefinition đã về playbackSpeed 1 trừ các ngoại lệ chốt trên.",
        "Chỉnh hướng chém bằng mắt trong game: F10 hiện 6 đòn vừa chém, [ ] xoay ±15°, tự lưu.",
        "Kĩ năng vũ khí (G) đã bỏ hẳn (03/10).",
        "Catalog còn 347 entry để giữ save cũ, nhưng WeaponCatalog.Active chỉ còn 73 món: kiếm 16, giáo 15, khiên 14, cung 12, đại kiếm 6, dao 4 và nhóm còn lại."
      ],
      "numbers": [
        [
          "Bộ đòn",
          "6"
        ],
        [
          "Loại vũ khí",
          "14"
        ]
      ],
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Combat/PlayerCombat.cs",
        "Assets/_Game/Scripts/Runtime/Combat/WeaponMoveset.cs"
      ]
    },
    {
      "id": "catalog",
      "cat": "weapons",
      "name": "Catalog 347 vũ khí",
      "summary": "Mọi model vẫn có trong catalog để giữ save cũ; dữ liệu review đã đánh dấu 73 món hoạt động và 274 món retired.",
      "details": [
        "WeaponCatalog.Active loại retired khỏi nguồn phát đồ mới; Get(id) vẫn trả entry để save cũ tiếp tục nạp.",
        "Data/WeaponReview.json giữ lựa chọn và hạng; WeaponReview.Apply và WeaponCatalogBuilder áp lại sau mỗi lần build.",
        "Tempered Pike (pd_crysta_halberdl_01) đã chuyển Unique; model, icon và ID mọi món vẫn giữ.",
        "Nguồn Craftpix + POLYGON Dungeon; model có gốc tại chỗ nắm, trục +Y theo lưỡi; catalog web cho chỉnh và xuất JSON."
      ],
      "numbers": [
        [
          "Catalog",
          "347"
        ],
        [
          "Active",
          "73"
        ],
        [
          "Retired",
          "274"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Items/WeaponCatalog.cs"
      ]
    },
    {
      "id": "carry",
      "cat": "weapons",
      "name": "Cầm & đeo vũ khí",
      "summary": "Song kiếm đeo chéo X sau lưng, chuôi vừa nắm tay, vũ khí đeo tự khớp với từng ngoại hình.",
      "details": [
        "WeaponRig dựng vũ khí khi chạy; WeaponSheathBuilder, HiltFit, TwoHandGrip và SheathFit xử lý chỗ nắm, tay trái và đeo theo thân.",
        "Song kiếm chéo sau lưng; đại kiếm/thương/cung sau lưng; kiếm đơn và katana ở hông.",
        "WeaponTuner và WeaponPoses giữ chỉnh tay; StrikeYawOverrides giữ hướng chém từng đòn.",
        "Các phép đo fit thời Fantasy Hero là dữ liệu lịch sử; cần rà lại từng loại trên Sidekick hiện tại."
      ],
      "numbers": [
        [
          "Moveset đang dùng",
          "6"
        ],
        [
          "Model hiện tại",
          "Sidekick"
        ]
      ],
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Player/WeaponRig.cs",
        "Assets/_Game/Scripts/Runtime/Player/TwoHandGrip.cs"
      ]
    },
    {
      "id": "loot",
      "cat": "items",
      "name": "Hạng đồ & dòng chỉ số",
      "summary": "4 độ hiếm hiển thị, dòng prefix / suffix theo 6 tier; catalog giữ enum cũ để tương thích save.",
      "details": [
        "Normal không có dòng; Magic tối đa 1 prefix + 1 suffix; Rare tối đa 3 + 3; Unique có dòng cố định. Heroic cũ quy về Rare, Legendary/Mythic hiển thị chung Unique.",
        "Tier T6 → T1 mở ở item level 1 / 15 / 30 / 45 / 60 / 75.",
        "Tỉ lệ rơi: Trắng 70 / Xanh 25 / Tím 4.8 / độc nhất 0.2%; elite +200%, boss +400%.",
        "Mỗi boss có độc nhất riêng 15% + 5% mỗi lần hụt (chống xui, lưu trong save).",
        "Đồ rơi là model 3D bay ra và nảy trên sàn; F nhặt; tên đồ dưới đất kiểu PoE2 (Alt ẩn/hiện).",
        "Hiệu ứng và âm rơi theo độ quý: Magic, Rare, Unique, vàng và một số gem có tiếng riêng; đồ Normal và món nhỏ không có tiếng. Sun Tear và Tear of Rebirth dùng âm cao nhất.",
        "Một xác rơi nhiều món thì ra lần lượt cách nhau 0.5 s, tiếng phát lúc món bắt đầu rơi.",
        "Vàng, vật liệu, tên, đồ ăn tự vào túi khi đi qua (1.2 m); món vừa nhặt hiện thành dòng ở mép phải trên thanh skill.",
        "Alt ẩn tên đồ nhưng món đang nhìn và món F sẽ nhặt vẫn hiện tên."
      ],
      "numbers": [
        [
          "Độ hiếm",
          "4"
        ],
        [
          "Tier",
          "6"
        ],
        [
          "Kiểu hiệu ứng rơi",
          "13"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/LootFx.cs",
        "Assets/_Game/Scripts/Runtime/Items/WeaponCatalog.cs",
        "Assets/_Game/Scripts/Runtime/Items/WeaponStash.cs",
        "Assets/_Game/Scripts/Runtime/Items/WeaponAffixes.cs"
      ]
    },
    {
      "id": "crafting",
      "cat": "items",
      "name": "Chế tạo & nâng cấp",
      "summary": "8 gem chế tạo, nâng cấp +10 có thể thất bại, quality và chuyển cấp.",
      "details": [
        "Kindle, Crown, Blaze, Wildfire, Twin-Moon Prism, Star Forge, Void Pearl và Sun Tear. Ascension đã bỏ; không dùng gem chế tạo lên Unique.",
        "Twin-Moon Prism chọn 1 trong 3 dòng; Star Forge hiến một món để chép dòng; Void Pearl có 25% xoá nhầm; Sun Tear chỉ giữ giá trị roll cao hơn.",
        "Nâng cấp cần 3 Forge Stone đúng bậc và 200 → 20,000 vàng, tăng +6% → +70% chỉ số gốc. Từ +7 đến +10, tỉ lệ thành công lần đầu là 80/65/50/35%; mỗi lần hụt cộng 10 điểm phần trăm. +10 còn cần Ancient Forge Stone.",
        "Quality 0–20% bằng Đá Mài; chuyển cấp sang vũ khí khác (−2 cấp, 400 vàng/cấp).",
        "Thao tác: chuột phải nguyên liệu rồi click vào món cần áp."
      ],
      "numbers": [
        [
          "Gem chế tạo",
          "8"
        ],
        [
          "Cấp nâng tối đa",
          "+10"
        ],
        [
          "Quality",
          "0–20%"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Items/WeaponAffixes.cs",
        "Assets/_Game/Scripts/Runtime/Player/PlayerInventory.cs"
      ]
    },
    {
      "id": "gear",
      "cat": "items",
      "name": "Trang bị & flask",
      "summary": "Nhân vật đã chuyển sang Synty Sidekick. Builder hiện có 233 mảnh trang bị trong 5 ô Body, Gloves, Boots, Helmet, Side; trang web riêng có catalog để review.",
      "details": [
        "233 mảnh: Helmet 40, Body 25, Gloves 21, Boots 20, Side 127; gồm Knights, Sorcerers, Samurai và Viking.",
        "Body = thân + hông; Gloves = tay trên + tay dưới + bàn tay; Boots = chân + bàn chân; Helmet = phụ kiện đầu; Side = một phụ kiện.",
        "Side thay ô Cape. SidekickDresser gắn mảnh bằng tên xương, giữ extra bones và bảng màu đúng bộ.",
        "Bậc hiện chấm theo số đỉnh trong cùng loại, cần review bằng hình; giáp Fantasy Hero cũ được PlayerInventory.RetiredGear loại khỏi save.",
        "Agility né theo Ag/(Ag+Accuracy), trần 75%. Spellguard chờ 7 s rồi hồi 15%/s; giảm delay có sàn 1 s.",
        "Flask có 4 tier: Life 35/40/45/50%, Mana 30/45/60/80, hồi trong 2 s; 60–90 charge, cơ bản tốn 20 mỗi lần."
      ],
      "numbers": [
        [
          "Mảnh trang bị",
          "233"
        ],
        [
          "Ô",
          "Body / Gloves / Boots / Helmet / Side"
        ],
        [
          "Gói chính",
          "Knights / Sorcerers / Samurai / Viking"
        ],
        [
          "Tier flask",
          "4"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Items/ModularGear.cs",
        "Assets/_Game/Scripts/Runtime/Items/GearStats.cs",
        "Assets/_Game/Scripts/Runtime/Items/Flasks.cs"
      ]
    },
    {
      "id": "inventory",
      "cat": "ui",
      "name": "Túi đồ & kho",
      "summary": "Túi I ở nửa phải, Skills G và Character O ở nửa trái, Passives P toàn màn hình; ô Side thay Cape, kho Stash và hai bộ vũ khí vẫn có.",
      "details": [
        "Click trái nhấc món lên (không cần giữ chuột), click trái lần nữa để đặt; ra ngoài cửa sổ = vứt xuống đất (nằm 5 phút).",
        "Chuột phải = dùng ngay: mặc đồ, uống, lắp ngọc, cắt ngọc thô. Chuột phải món đang mặc = tháo; túi đầy thì hỏi vứt ra đất hay giữ.",
        "Thẻ item chi tiết (dòng, tier, yêu cầu đỏ khi thiếu), lọc theo nhóm, kéo-thả vẫn dùng được.",
        "Không còn trọng lượng (GDD)."
      ],
      "numbers": [
        [
          "Lưới",
          "12 × 8"
        ],
        [
          "Ô trang bị",
          "10 + 2 flask"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/UI/InventoryWindow.cs"
      ]
    },
    {
      "id": "skills",
      "cat": "character",
      "name": "Skill gem & support",
      "summary": "36 SkillDefinition đã sinh trong Resources/Skills, 33 support rune có rule Fits theo tag, cooldown và damage; các skill Allz mới đã có dữ liệu.",
      "details": [
        "36 asset SkillDefinition trong Resources/Skills; 33 SupportRune trong code. 6 ô Q E R T C X, support sockets 2–5, gem level 1–20.",
        "Fire Shot tách đạn theo cấp gem; Cascade thêm tầng tách. Frost Wall thi triển 1.5 s, cooldown 7 s, tồn tại 7 s; Multiple Projectiles thêm nhánh, Encircle thành vòng, Brittle giảm máu và tăng nổ.",
        "Deathbloom là bị động; Black Hole hút, Blink dịch chuyển; Twister nhận nguyên tố từ nền. Comet đổi nguyên tố theo Added Fire/Lightning.",
        "Shadow Double, Restless Spirits và Soul Bind có runtime riêng; SupportRune.Fits hiện từ chối cả ba nhóm này.",
        "Skill Forge cấp 1–20 tạo/nâng gem; Support Seed bậc 1–6; Chisel mở lỗ, Lustre thêm quality. Gem cần cấp nhân vật tới 90 ở gem level 20.",
        "DamageAt = 1 + 0.12 × (level−1), CostAt = 1 + 0.05 × (level−1); đã có bảng yêu cầu cấp/thuộc tính.",
        "Support mới đã có rule tương thích và cặp xung đột; số liệu trên web lấy asset và báo cáo builder, không thay cho đo DPS thực chiến."
      ],
      "numbers": [
        [
          "Ô skill",
          "6"
        ],
        [
          "Support",
          "33"
        ],
        [
          "Level gem",
          "1–20"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Combat/SkillGems.cs",
        "Assets/_Game/Scripts/Runtime/Combat/SupportRune.cs",
        "Assets/_Game/Scripts/Runtime/Player/PlayerSkills.cs"
      ]
    },
    {
      "id": "progression",
      "cat": "character",
      "name": "Level, thuộc tính & cây passive",
      "summary": "Level 1–100, 5 thuộc tính; PassiveTree phiên bản 5 đã có 6 nhánh và 19 định nghĩa keystone, cùng socket rune và cụm skill.",
      "details": [
        "Vigor +15 Life; Endurance +2 Stamina và +2 Poise; Strength +2 Life, +0.4% attack damage, +0.5% Armour mỗi điểm.",
        "Dexterity +0.5% stamina recovery và −0.25% stamina cost; Intelligence +3 Mana, +0.6% Spellguard, +0.5% spell damage mỗi điểm.",
        "PassiveTree version 5 có 6 nhánh: Intelligence, Dexterity, Vitality, Strength, Summoner, Mimic; 19 định nghĩa keystone và socket rune. Tổng node sinh lúc chạy chưa đếm lại trong lần audit này.",
        "Lên cấp nhận 1 điểm thuộc tính và 1 passive; level tối đa 100, thuộc tính tối đa 99. Đổi phiên bản cây hoàn điểm cũ.",
        "Hoàn điểm tại The Unbinder; rune cắm cây cần được Runereader đọc trước."
      ],
      "numbers": [
        [
          "Level tối đa",
          "100"
        ],
        [
          "PassiveTree version",
          "5"
        ],
        [
          "Keystone definitions",
          "19"
        ],
        [
          "Life nền",
          "80 + thuộc tính"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Player/PassiveTree.cs",
        "Assets/_Game/Scripts/Runtime/Player/CharacterStats.cs"
      ]
    },
    {
      "id": "damage",
      "cat": "character",
      "name": "Loại sát thương & kháng",
      "summary": "Vật lý, Lửa, Băng, Sét, Chaos; giáp giảm vật lý, kháng nguyên tố tối đa 77%, sàn −60%.",
      "details": [
        "5 loại: Physical, Fire, Cold, Lightning, Chaos. FoeDefence tính Armour/kháng theo cấp và loại quái; hỗ trợ xuyên kháng.",
        "Kháng người chơi trần 77%, sàn −60%; mỗi chương hoàn thành phạt 6% Fire/Cold/Lightning, tối đa 60%; Chaos không bị phạt.",
        "Quái thường có Armour theo cấp/thể hình, kháng nguyên tố bản thân 20–40%; Rare/boss và Fireproof có cộng thêm.",
        "Ailments có ignite, chill/freeze, shock, curse, pull; Shock khiến nhận thêm 20% damage trong 4 s."
      ],
      "numbers": [
        [
          "Loại",
          "5"
        ],
        [
          "Kháng tối đa",
          "77%"
        ],
        [
          "Kháng sàn",
          "−60%"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Combat/DamageTypes.cs",
        "Assets/_Game/Scripts/Runtime/Player/CharacterStats.cs"
      ]
    },
    {
      "id": "bosses",
      "cat": "enemies",
      "name": "Boss",
      "summary": "8 boss trong Crimson Castle: AI giữ khoảng cách, delay giả, phase 2, thanh thế; mỗi boss có độc nhất riêng.",
      "details": [
        "AI chung: chọn move theo khoảng cách / trọng số / cooldown, đòn nhiều bước có cửa sổ hitbox, đòn đỏ chỉ né được.",
        "Phase 2 với nhạc riêng crossfade; boss lần đầu dưới 30% Life channel 2 s rồi hồi 35% Life, một lần mỗi trận.",
        "Boss lâu đài ngủ tới khi người chơi bước vào phòng; chết thì hồi sinh ở cửa phòng boss.",
        "Boss khổng lồ: đòn cúi theo chiều cao người chơi (aimPitch từng bước).",
        "Moveset Warden/Valkyrie vẫn là nguồn animation; danh sách boss lâu đài hiện có 8 entry và đã được kiểm bằng Castle/Dungeon probes."
      ],
      "numbers": [
        [
          "Boss lâu đài",
          "8"
        ],
        [
          "Thế giới Rift khai báo",
          "7"
        ],
        [
          "Mass heal",
          "35% Life / 2 s"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Boss/BossController.cs"
      ]
    },
    {
      "id": "monsters",
      "cat": "enemies",
      "name": "Quái thường & elite",
      "summary": "41 prefab quái trong project, dùng các nhóm animator kiếm/nặng/phép; thiết kế rarity Magic/Rare và 6 mod đã có.",
      "details": [
        "AI đơn giản: thấy (tầm + tầm nhìn) → gọi đồng đội 9 m → đuổi → đánh → hồi. Kẹt thì dò hai bên để vòng qua vật cản.",
        "Đòn cận chiến có thể đỡ / deflect / lăn qua; bị deflect hoặc vỡ thế thì người chơi kết liễu được.",
        "Elite to gấp 2–2.5 lần người chơi, siêu giáp; tầm đánh theo chiều dài vũ khí thật.",
        "Magic 15% (1–2 mod), Rare 5% (3–4 mod): Hasted, Regenerating, Fireproof, Reflective, Rallying (gọi bản sao), Volatile (nổ khi chết).",
        "30 quái đặt trong lâu đài; sống lại khi nghỉ lửa trại hoặc chết.",
        "Willowmere có WildSpawner ngày/đêm; quái đi lại quanh site, bỏ đuổi quá 30 m, ngủ quá 75 m và không vẽ quá 160 m."
      ],
      "numbers": [
        [
          "Prefab quái",
          "41"
        ],
        [
          "Mod",
          "6"
        ],
        [
          "Level theo vùng",
          "Có"
        ],
        [
          "Khoảng ngủ",
          ">75 m"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Enemies/EnemyController.cs",
        "Assets/_Game/Scripts/Runtime/World/AreaLevel.cs"
      ]
    },
    {
      "id": "castle",
      "cat": "world",
      "name": "Crimson Castle",
      "summary": "Lâu đài rẽ nhánh 13 phòng, 7 phòng boss phụ, Cathedral trần 22 m cho boss cuối.",
      "details": [
        "Bố cục khai báo bằng hình chữ nhật trên lưới 1 m; tường, sàn, trần, khung cửa sinh tự động; kiểm BFS mọi phòng tới được.",
        "Gate Hall → Great Hall (phòng trung tâm 4 cửa) → Library / Armory / Crypt → Cathedral; Library có lối tắt (vòng lặp).",
        "~160 đèn thật (đuốc, đèn chùm, lò than, nến) nhấp nháy như lửa; 14 đèn gần nhất đổ bóng mềm.",
        "7 rương, 3 lửa trại, NPC cốt truyện xuất hiện ngẫu nhiên 1 trong 5 chỗ."
      ],
      "numbers": [
        [
          "Phòng",
          "13"
        ],
        [
          "Đèn",
          "~160"
        ],
        [
          "Rương",
          "7"
        ],
        [
          "Lửa trại",
          "3"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/DungeonDirector.cs"
      ]
    },
    {
      "id": "willowmere",
      "cat": "world",
      "name": "Làng Willowmere",
      "summary": "Thung lũng mở 600 × 520 m quanh một thị trấn: đồi, sông, hồ có đảo, hố sụt sâu 14 m, ngày / đêm, quái ngoài hoang dã.",
      "details": [
        "Thị trấn phẳng ở giữa, 7 con đường toả ra từ đài phun nước; ngoài thị trấn là đồi cao 9 m (20 m sát núi), mesa phía đông.",
        "Nền là Unity Terrain vẽ được bằng 7 lớp chất liệu của gói Meadow (cỏ, lá rụng, đá, bùn, đất, đá cuội); đường và quảng trường là sơn trên terrain (04/10).",
        "Cỏ 3D chỉ mọc quanh camera và chỉ nơi terrain sơn cỏ — vẽ đường mới là cỏ tự mất.",
        "6 NPC có trạm (thợ rèn, thầy thuốc, bếp, tạp hoá, Hall of Memories, The Unbinder) và Runereader được đặt runtime ở quảng trường.",
        "Một ngày đêm = 24 phút thật; đêm có trăng, sương dày hơn, quái nhiều hơn. Sương mù dày dần theo khoảng cách: núi xa ~300 m chỉ còn bóng nhạt.",
        "8 lửa trại; rơi xuống nước sâu thì được đưa về bờ."
      ],
      "numbers": [
        [
          "Kích thước",
          "600 × 520 m"
        ],
        [
          "Lớp terrain",
          "7"
        ],
        [
          "Lửa trại",
          "8"
        ],
        [
          "Ngày đêm",
          "24 phút"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/WildSpawner.cs"
      ]
    },
    {
      "id": "hub",
      "cat": "world",
      "name": "Dịch vụ Willowmere & trang trại",
      "summary": "6 trạm dịch vụ chính và Orrin the Runereader được nối vào Willowmere. Farm còn code sản xuất theo giờ, chưa gắn vào scene hiện tại.",
      "details": [
        "Brannoc (thợ rèn): gỡ dòng, Khắc Ấn, rune trang bị, phân giải, rèn base mới + 5 base đặc biệt từ trophy boss.",
        "Old Mirelle (thầy thuốc): 10 thuốc buff. Hesta (bếp): 5 món + Honey Milk.",
        "Quill (tạp hoá): 14 đồ vui có cơ chế thật — vịt dụ quái, pháo hoa choáng, điện thoại cục gạch ném, kẹo cao su làm chậm, trà sữa bắn trân châu…",
        "Keeper Aldous (Hall of Memories): đánh lại boss lâu đài đã hạ. The Unbinder: hoàn điểm passive / thuộc tính.",
        "Trang trại: ruộng, vườn thảo dược, hầm nấm, gà, bò, ong, ao cá, mỏ; chạy theo giờ thật, trữ tối đa 12 h.",
        "ESC → Game → Travel hiện có Willowmere, Sunscar (sau south_gate), Crimson Castle và Training Room; Rift mở từ cổng riêng."
      ],
      "numbers": [
        [
          "Trạm chính",
          "6"
        ],
        [
          "Runereader",
          "Orrin"
        ],
        [
          "Farm",
          "Chưa tích hợp làng"
        ]
      ],
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Hub/HubWorld.cs",
        "Assets/_Game/Scripts/Runtime/Hub/Stations.cs",
        "Assets/_Game/Scripts/Runtime/Hub/Farm.cs"
      ]
    },
    {
      "id": "scenes",
      "cat": "world",
      "name": "Các khu khác",
      "summary": "Build Settings hiện có 5 scene chơi: Willowmere, TrainingRoom, CrimsonCastle, Rift và Sunscar; Weapon Tuner là scene công cụ riêng.",
      "details": [
        "Willowmere: xem mục riêng.",
        "Training Room: hình nộm, cột leo, xà chui, 1 lửa trại, rương vô tận (F: tuôn đồ ngẫu nhiên mỗi 0.5 s để test).",
        "Weapon Tuner: scene công cụ chỉnh tư thế vũ khí.",
        "Các scene demo và Hearthvale/Eldmoor cũ đã xoá; Willowmere là scene mở đầu build hiện tại."
      ],
      "numbers": [
        [
          "Scene trong Build Settings",
          "5"
        ],
        [
          "Scene công cụ",
          "1"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "ProjectSettings/EditorBuildSettings.asset"
      ]
    },
    {
      "id": "save",
      "cat": "tech",
      "name": "Lưu game",
      "summary": "JSON: level, thuộc tính, passive, túi đồ, vàng, kho, trang trại, chống xui boss.",
      "details": [
        "Tự ghi ~2 s sau mỗi thay đổi, khi rời scene và khi thoát; túi và nhân vật mang qua mọi scene.",
        "Phiên test tự động không đọc / ghi save (không phá tiến trình thật)."
      ],
      "numbers": [
        [
          "Định dạng",
          "JSON"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Save/SaveGame.cs"
      ]
    },
    {
      "id": "hud",
      "cat": "ui",
      "name": "HUD & menu",
      "summary": "HUD có Life/Mana, EXP, skill và thanh boss; I/G/O/P/J/M mở các cửa sổ túi, skill, nhân vật, passive, quest và bản đồ.",
      "details": [
        "Skill bị động không hiện như nút cast trên HUD; không còn ô kỹ năng vũ khí G.",
        "Dialogue, QuestTracker, QuestBanner và Loc/LText đã có trong runtime.",
        "Settings có đồ hoạ, âm thanh, phím và Travel; creator Appearance chỉ có trong Editor.",
        "Chưa có màn tiêu đề/mở đầu và hướng dẫn phím đầy đủ lần đầu; GemTutorial đã có hướng dẫn ngọc."
      ],
      "numbers": [
        [
          "Ô skill",
          "6"
        ],
        [
          "Ngôn ngữ nguồn",
          "English"
        ],
        [
          "Dịch UI",
          "Loc / LText"
        ]
      ],
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/UI/CharacterHud.cs",
        "Assets/_Game/Scripts/Runtime/UI/SettingsWindow.cs"
      ]
    },
    {
      "id": "appearance",
      "cat": "character",
      "name": "Nhân vật & ngoại hình",
      "summary": "Synty Sidekick Humanoid đủ ngón, cao khoảng 1.89 m; xương prefab riêng, thân/đầu/tóc/giáp là các mảnh ModularGear gắn theo tên xương.",
      "details": [
        "Synty Sidekick Humanoid đủ ngón, prefab bộ xương; mesh thân, đầu, tóc và giáp lắp lên theo tên xương.",
        "SidekickLook lưu loài, bodyType/bodySize/muscles, các mảnh khuôn mặt/tóc và màu theo ô; bản build đọc Resources/DefaultLook.json.",
        "Creator Appearance chỉ dùng trong Unity Editor; Save as starting look ghi look khởi đầu. Website gear có ảnh lựa chọn để review.",
        "SidekickDresser cấp vật liệu cho mọi submesh, dùng bảng màu 32×32 đúng bộ và dựng các xương phụ còn thiếu.",
        "Gói Fantasy Hero còn trong Assets nhưng không còn là model người chơi; ảnh model cũ trên gallery là lịch sử."
      ],
      "numbers": [
        [
          "Chiều cao",
          "~1.89 m"
        ],
        [
          "Mảnh trang bị",
          "233"
        ],
        [
          "Ô gear",
          "5"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Player/SidekickLook.cs",
        "Assets/_Game/Scripts/Runtime/Player/ModularOutfit.cs",
        "Assets/_Game/Scripts/Runtime/UI/SettingsWindow.Character.cs"
      ]
    },
    {
      "id": "audio",
      "cat": "av",
      "name": "Âm thanh & nhạc",
      "summary": "Đã catalog 140 SFX và preview trên tab Âm thanh; runtime có CombatAudio, SoundLevels theo từng clip, SFX group và boss cues.",
      "details": [
        "Nhạc boss gen bằng Lyria (2 bài mỗi boss, crossfade khi đổi phase), cắt vòng lặp đúng nhịp.",
        "Tab web cho nghe thử, chỉnh gain tuyệt đối, lưu local và xuất JSON; preview không normalize và không mô phỏng 3D attenuation.",
        "Gain game hiện đọc SoundLevels theo AudioClip.name; file JSON hướng dẫn AI giữ override qua builder."
      ],
      "numbers": [
        [
          "SFX catalog",
          "140"
        ],
        [
          "Preview",
          "140"
        ],
        [
          "Nhạc nền",
          "tách riêng"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Audio/CombatAudio.cs",
        "Assets/_Game/Scripts/Runtime/Audio/SoundLevels.cs"
      ]
    },
    {
      "id": "fx",
      "cat": "av",
      "name": "Hiệu ứng hạt",
      "summary": "FX library đã nối vào skill, quái và boss; Allz skills có màu nguyên tố, Frost Wall, Twister và shock arcs runtime.",
      "details": [
        "Perfect parry: chớp sao + tia lửa vàng → cam → đỏ có trọng lực.",
        "Fire Shot có split theo cấp gem và Cascade; Frost Wall có cột mọc lần lượt, Multiple Projectiles và Encircle.",
        "Boss phase heal và phase shift gọi BossFx; Shock tạo tia nhỏ định kỳ."
      ],
      "numbers": [
        [
          "Prefab FX",
          "180+"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Fx/BossFx.cs",
        "Assets/_Game/Scripts/Runtime/Player/PlayerSkills.cs"
      ]
    },
    {
      "id": "pipeline",
      "cat": "tech",
      "name": "Pipeline & kiểm thử",
      "summary": "Scene, animator, dữ liệu đòn và catalog đều sinh bằng builder; các probe Play-mode ghi kết quả vào Temp/WhosnextJobs.",
      "details": [
        "Builder sinh scene/animator/dữ liệu; ngoại lệ terrain Willowmere, WeaponPoses và StrikeYawOverrides do người dùng chỉnh.",
        "Job bridge chạy phương thức editor và trả log/probe; phiên Play test không đọc/ghi save người dùng.",
        "Website có catalog vũ khí, gear và SFX với bản nháp/JSON. Lần cập nhật này chỉ đọc project, không chạy lại Unity hay thay đổi asset game.",
        "Các số liệu nội dung lấy từ asset/code ngày 10/10; ghi chú kiểm thử cũ không được xem là kiểm chứng lại trên Sidekick mới."
      ],
      "numbers": [
        [
          "Build scenes",
          "5"
        ],
        [
          "Source audit",
          "2026-10-10"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Editor/EditorJobRunner.cs"
      ]
    },
    {
      "id": "rift",
      "cat": "world",
      "name": "Rift & Sunscar",
      "summary": "7 thế giới Rift khai báo, bản đồ ngẫu nhiên một tầng mỗi chuyến; Sunscar đã có scene và Travel theo cờ south_gate.",
      "details": [
        "RiftRun.Floors = 1; RiftGenerator dựng map và RiftDirector khoá arena tới khi hạ 75% quái.",
        "3 thế giới cốt truyện: The Broken Stone Forest, The Chained Abyss, The Orchard of Ash; các biến thể farm: The Violet Hollow, The Ember Forge, The Verdant Tomb, The Gilded Hall.",
        "Chuyến story miễn phí khi quest yêu cầu boss; chuyến farm tiêu Rift Stone và chọn từ thế giới đã mở. The Gilded Hall còn phụ thuộc cờ chương 4.",
        "Chết hoặc ra cổng sau boss quay về scene xuất phát, giữ đồ đã nhặt; boss chỉ thức khi bước vào arena.",
        "Willowmere theo sàn chương; Sunscar ít nhất cấp 8; CrimsonCastle cấp 6; boss +2 cấp, elite +1. Máu/sát thương quái đã scale theo AreaLevel."
      ],
      "numbers": [
        [
          "Thế giới khai báo",
          "7"
        ],
        [
          "Tầng mỗi chuyến",
          "1"
        ],
        [
          "Mở arena",
          "Hạ 75% quái"
        ]
      ],
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftRun.cs",
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftDirector.cs",
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftWorlds.cs"
      ]
    }
  ],

  weapons: [
    {
      "id": "twin",
      "name": "Song kiếm",
      "img": [
        "img/w-dual-held-front.jpg",
        "img/w-dual-worn-back.jpg",
        "img/w-dual-worn-backhigh.jpg"
      ],
      "text": "Hai kiếm một tay, mỗi lưỡi dùng chỉ số kiếm của nó. Rút qua vai từ chữ X sau lưng.",
      "facts": [
        "Bộ đòn: Dual Sword (9CG)",
        "Đeo: chéo X sau lưng",
        "Tay phụ ×0.75 sát thương"
      ]
    },
    {
      "id": "sword",
      "name": "Kiếm một tay",
      "img": [
        "img/w-sword-worn-left.jpg"
      ],
      "text": "16 kiếm một tay active trong 33 entry catalog; bộ đòn kiếm đơn 9CG.",
      "facts": [
        "Đeo: hông trái",
        "Chuôi rút gọn vừa nắm tay"
      ]
    },
    {
      "id": "greatsword",
      "name": "Đại kiếm",
      "img": [
        "img/w-greatsword-held-front.jpg",
        "img/w-greatsword-worn-back.jpg",
        "img/w-greatsword-held-fist.jpg"
      ],
      "text": "6 đại kiếm active trong 23 entry catalog; tay trái IK theo curve clip.",
      "facts": [
        "Bộ đòn: Massive GreatSword",
        "Đeo: chéo lưng, chuôi vai phải"
      ]
    },
    {
      "id": "katana",
      "name": "Katana / Trường kiếm",
      "img": [
        "img/w-crimson-held-fist.jpg",
        "img/w-crimson-worn-left.jpg",
        "img/w-longblade-worn-left.jpg"
      ],
      "text": "Crimson Katana + trường kiếm mảnh. Rút kiểu iai từ hông.",
      "facts": [
        "Bộ đòn: Katana (9CG)",
        "Đeo: thắt lưng trái, chuôi phía trước"
      ]
    },
    {
      "id": "bow",
      "name": "Cung",
      "img": [
        "img/w-bow-held-front.jpg",
        "img/w-bow-worn-back.jpg"
      ],
      "text": "12 cung active trong 23 entry catalog; ngắm qua vai và tên có trọng lực.",
      "facts": [
        "Bộ đòn: Archer (9CG) + Longbow (Mixamo)",
        "Đeo: phẳng trên lưng"
      ]
    },
    {
      "id": "spear",
      "name": "Thương / Kích",
      "img": [
        "img/w-spear-held-front.jpg",
        "img/w-spear-worn-back.jpg"
      ],
      "text": "Thương dùng chuỗi 5 bước của 9CG Spear; buffer nối đòn, BladeLevel và hitbox cán trước đã được thêm.",
      "facts": [
        "Bộ đòn: Spear (9CG)",
        "Cầm một tay ở giữa thân như gói",
        "Đeo: chéo lưng, mũi qua vai trái"
      ]
    }
  ],

  bosses: [
    { name: 'Crimson Archdemon', where: 'Cathedral (lâu đài)', element: 'Lửa 50%', note: 'Boss cuối lâu đài, cao ~4 m, đại kiếm 3.1 m' },
    { name: 'Dread Slayer', where: "Slayer's Hall", element: 'Chaos 35%', note: 'Phòng boss phụ, đông Gate Hall' },
    { name: 'Blighted Mutant', where: 'Mutant Pit', element: 'Chaos 50%', note: 'Tây Gate Hall' },
    { name: 'Cave Troll', where: 'Troll Den', element: 'Vật lý', note: 'Sau Armory' },
    { name: 'Barbarian Giant', where: "Giant's Hall", element: 'Băng 30%', note: 'Bắc Library' },
    { name: 'Clockwork Golem', where: 'Clockwork Forge', element: 'Sét 40%', note: 'Đông Crypt' },
    { name: 'Elemental Golem', where: 'Elemental Sanctum', element: 'Lửa / Băng / Sét 40%', note: 'Đổi nguyên tố theo đòn' },
    { name: 'Fortress Golem', where: 'Fortress Vault', element: 'Vật lý', note: 'Đông Cathedral' },
  ],

  castleRooms: [
    ['Gate Hall', '18 × 20 m', 'Cổng vào, lửa trại đầu tiên'],
    ['Great Hall', '32 × 34 m', 'Phòng trung tâm 4 cửa, quái goblin'],
    ['Library', '24 × 22 m', 'Pháp sư; lối tắt về khúc quanh phía bắc'],
    ['Armory', '14 × 16 m', 'Quái nặng'],
    ['Crypt', '22 × 28 m', 'Undead; lửa trại cuối Crypt'],
    ['Cathedral', '38 × 62 m, trần 22 m', 'Crimson Archdemon'],
    ['7 phòng boss phụ', '', 'Mỗi phòng một hành lang riêng, không nằm trên đường chính'],
  ],

  controls: [
    [
      "W A S D",
      "Di chuyển"
    ],
    [
      "Shift",
      "Chạm: né · Giữ: chạy nhanh"
    ],
    [
      "Space",
      "Nhảy (bunny hop)"
    ],
    [
      "Ctrl",
      "Ngồi"
    ],
    [
      "Chuột trái",
      "Đòn nhẹ"
    ],
    [
      "Shift + Chuột trái",
      "Đòn nặng"
    ],
    [
      "Chuột phải",
      "Đỡ / deflect · Cung: ngắm"
    ],
    [
      "Chuột giữa",
      "Lock-on"
    ],
    [
      "Q E R T C X",
      "6 ô skill"
    ],
    [
      "Z",
      "Rút / cất vũ khí"
    ],
    [
      "Tab",
      "Đổi bộ vũ khí"
    ],
    [
      "F",
      "Tương tác, nhặt, mở rương, nghỉ lửa trại"
    ],
    [
      "1 / 2",
      "Flask máu / mana"
    ],
    [
      "3 – 9 + V",
      "Chọn & dùng món nhanh"
    ],
    [
      "Alt",
      "Ẩn / hiện tên đồ rơi"
    ],
    [
      "/",
      "Nhả chuột"
    ],
    [
      "Esc",
      "Menu"
    ],
    [
      "I / G / O / P",
      "Túi / Skills / Nhân vật / Passive"
    ],
    [
      "J / M",
      "Quest / Bản đồ"
    ],
    [
      "F1 / F10",
      "Debug HUD / chỉnh hướng chém (Editor)"
    ]
  ],

  // lane: now | next | later | idea
  roadmap: [
    {
      "lane": "now",
      "cat": "character",
      "title": "Kiểm tra Sidekick với combat và gear mới",
      "text": "Rà tay cầm, áo/váy, tư thế đeo và các combo trên model mới; kết quả đo thời Fantasy Hero không tự áp sang Sidekick.",
      "implementation": "partial",
      "evidence": []
    },
    {
      "lane": "now",
      "cat": "tech",
      "title": "Giảm dung lượng Sidekick trong bản build",
      "text": "Có 11 gói trong Resources/Meshes; cần loại phần không dùng và đo dung lượng bản build.",
      "implementation": "planned",
      "evidence": []
    },
    {
      "lane": "next",
      "cat": "ui",
      "title": "Màn tiêu đề và hướng dẫn lần đầu",
      "text": "Willowmere đã đứng đầu Build Settings; còn màn vào game, mở đầu và hướng dẫn phím. GemTutorial đã hướng dẫn ngọc.",
      "implementation": "partial",
      "evidence": []
    },
    {
      "lane": "next",
      "cat": "story",
      "title": "Quest của Runereader",
      "text": "Orrin đã đọc rune bằng vàng; quest mở đọc miễn phí chưa có.",
      "implementation": "partial",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Items/GearRunes.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Quest core: QuestDefinition + QuestLog + lưu save",
      "text": "QuestDef/StoryBook, QuestLog, SaveGame và UI quest đã có; 18 quest trong dữ liệu.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Story/QuestLog.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Hội thoại kiểu Sekiro",
      "text": "Dialogue/Talker có điều kiện, lựa chọn và nội dung file; chưa xác nhận lại toàn bộ thoại trên model mới.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Story/Dialogue.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Rift ngẫu nhiên + luật chết",
      "text": "Map một tầng/chuyến, arena mở sau 75% quái; quay về nơi xuất phát và giữ đồ.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftRun.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Chương 1 — The First Rift",
      "text": "Quest first_rift và The Broken Stone Forest / Hollow Slayer đã có dữ liệu và runtime.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftWorlds.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Level quái theo chương + level người chơi",
      "text": "Đã đổi luật: vùng mở theo sàn chương, Rift farm theo tier; không còn cộng theo level người chơi. Máu và damage đã scale.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/AreaLevel.cs"
      ]
    },
    {
      "lane": "next",
      "cat": "story",
      "title": "Aelvar trên trời Willowmere",
      "text": "Thiết kế cây khổng lồ và biến đổi theo chương còn cần xác nhận/triển khai; lần đọc source này chưa đủ căn cứ đánh dấu hoàn tất.",
      "implementation": "planned"
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Chương 2 — The Silent City",
      "text": "Nội dung thực tế hiện là quest sunscar và The Chained Abyss / Ashmaw, thay kế hoạch tên cũ.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/Rift/RiftWorlds.cs"
      ]
    },
    {
      "lane": "implemented",
      "cat": "story",
      "title": "Chương 3 — Those Who Follow the Seed",
      "text": "Có green_procession, lantern_bearer, orchard_of_ash; Sister Verdane, pollen và brazier có runtime riêng.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/World/Rift/VerdaneBoss.cs"
      ]
    },
    {
      "lane": "next",
      "cat": "story",
      "title": "Chương 4 — The Salt Sea",
      "text": "Biển cạn thành sa mạc muối; biên niên các thế giới đã chết; Boss 4.",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "story",
      "title": "Chương 5 — The Cold Forge",
      "text": "Núi lửa phủ băng rễ; bí mật Cold Ember; Brannoc rèn Torch Haft; Boss 5.",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "story",
      "title": "Side quest 6 NPC Willowmere",
      "text": "Willowmere.txt đã có quest cho các NPC và GemTutorial; chuỗi 2–3 quest mỗi người chưa hoàn tất. Quest mở miễn phí Runereader còn chờ.",
      "implementation": "partial"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương 6 — Beneath the Roots",
      "text": "Hầm mộ rễ giam hồn; hồn bị tiêu hoá; Boss 6.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương 7 — The Traitor",
      "text": "Rift mở trong Willowmere, làng bị tấn công; Boss 7; lựa chọn A: tha / xử kẻ phản bội.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương 8 — The Hanging Garden",
      "text": "Thế giới đang bị hút dở; Boss 8; lựa chọn B: cứu dân / lấy Anchor Root ngay.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương 9 — Mother Ilsabeth",
      "text": "Thánh địa Seedbound; Boss 9 Ilsabeth; lựa chọn C: tha / giết; nụ hoa hiện trên cây.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương 10 — The Root Warden",
      "text": "Rễ chính dưới gốc Aelvar; Boss 10; mở lối vào thân cây.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Chương cuối — Burn the World Tree",
      "text": "Bên trong thân Aelvar, nhiều pha; boss Heart of Aelvar; đốt cây bằng Cold Ember.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "3 kết thúc: Ashfall / The Seed / New Ember",
      "text": "Theo lựa chọn A, B, C, pha cuối và side quest; sau kết vẫn farm Rift tier cao.",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "story",
      "title": "Làng đổi theo tiến độ",
      "text": "Cỏ úa, sông cạn, cây to dần trên trời giữa các chương; hồi lại sau Ashfall.",
      "implementation": "planned"
    },
    {
      "lane": "idea",
      "cat": "story",
      "title": "Nghề phụ: câu cá",
      "text": "Sông, hồ, hố sụt Willowmere; cá bán lấy vàng.",
      "implementation": "planned"
    },
    {
      "lane": "idea",
      "cat": "story",
      "title": "Nghề phụ: trồng trọt",
      "text": "Dùng lại code trang trại Hearthvale trên ruộng Willowmere.",
      "implementation": "planned"
    },
    {
      "lane": "idea",
      "cat": "story",
      "title": "Nghề phụ: săn thú & chế biến",
      "text": "Thú thụ động ngoài hoang dã; bếp Hesta chế biến; bán lấy vàng.",
      "implementation": "planned"
    },
    {
      "lane": "now",
      "cat": "weapons",
      "title": "Chỉnh tư thế từng vũ khí bằng WeaponTuner",
      "text": "Người dùng tự chỉnh 4 tư thế cho mỗi loại vũ khí rồi lưu; game áp dụng ngay.",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "weapons",
      "title": "Animation cho các loại vũ khí còn lại",
      "text": "Dao găm, rìu, chuỳ, búa, rìu lớn, poleaxe, khiên — đang \"coming later\".",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "av",
      "title": "Âm thanh riêng cho Archdemon & tiếng chém theo vũ khí",
      "text": "Archdemon đang mượn bộ âm thanh Warden; mọi vũ khí dùng chung tiếng chém.",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "world",
      "title": "Hội thoại NPC \"Mysterious Knight\"",
      "text": "NPC cốt truyện trong lâu đài đã có chỗ đứng ngẫu nhiên, chưa có hội thoại.",
      "implementation": "planned"
    },
    {
      "lane": "next",
      "cat": "character",
      "title": "Cân bằng chỉ số gốc & sát thương quái theo level",
      "text": "Công thức scale đã có trong AreaLevel, EnemyController và BossController; còn playtest nhịp giết quái/boss và cân bằng với gear mới.",
      "implementation": "partial"
    },
    {
      "lane": "later",
      "cat": "items",
      "title": "Bảng affix đầy đủ theo slot & tier",
      "text": "WeaponAffixes/GearStats đã có định nghĩa và xử lý theo slot; cần kiểm độ phủ, tier và cân bằng trên bộ Sidekick mới.",
      "implementation": "partial"
    },
    {
      "lane": "next",
      "cat": "character",
      "title": "~40 skill gem + ~40 support",
      "text": "Hiện có 36 skill và 33 support trong code/asset; tiếp tục cân bằng và bổ sung theo nhu cầu build, không coi số mục tiêu là đã hoàn thành.",
      "implementation": "partial"
    },
    {
      "lane": "later",
      "cat": "world",
      "title": "Số vùng, boss và level từng vùng",
      "text": "5 scene build, 7 thế giới Rift khai báo, level sàn chương đã có; boss/map từ chương 4 chưa hoàn thiện.",
      "implementation": "partial"
    },
    {
      "lane": "later",
      "cat": "items",
      "title": "Công thức học dần, thú hiếm, mở rộng chuồng / ao",
      "text": "Hiện mọi công thức biết sẵn; trang trại mở từ đầu (công tắc test).",
      "implementation": "planned"
    },
    {
      "lane": "later",
      "cat": "tech",
      "title": "Tối ưu map rộng",
      "text": "Streaming vùng, LOD, culling, giới hạn bóng; đo lại hiệu năng sau khi dọn scene (benchmark giờ chạy Crimson Castle + Training Room).",
      "implementation": "planned"
    },
    {
      "lane": "idea",
      "cat": "items",
      "title": "Playtest tỉ lệ drop / upgrade / farm",
      "text": "Mục tiêu: quái chết sau 2–4 đòn nhẹ, trận boss 2–4 phút, 3–8 lần thử mỗi boss.",
      "implementation": "planned"
    },
    {
      "lane": "implemented",
      "cat": "character",
      "title": "Thuộc tính có giá trị hơn yêu cầu",
      "text": "Strength/Intelligence đã tăng sát thương, Endurance tăng Poise, Dexterity giảm stamina cost.",
      "implementation": "implemented",
      "evidence": [
        "Assets/_Game/Scripts/Runtime/Player/CharacterStats.cs"
      ]
    },
    {
      "lane": "idea",
      "cat": "world",
      "title": "Endgame",
      "text": "Để sau theo GDD.",
      "implementation": "planned"
    }
  ],

  // Change notes — newest first. cats tag which systems the note belongs to.
  changelog: [
    {
      "date": "2026-10-10",
      "cats": [
        "tech",
        "world",
        "story",
        "combat",
        "character",
        "weapons",
        "av"
      ],
      "title": "Đối chiếu tiến độ với code và asset hiện tại",
      "items": [
        "73/347 vũ khí active, 233 mảnh Sidekick, 36 skill, 33 support, 41 prefab quái, 18 quest, 7 thế giới Rift khai báo và 5 scene build.",
        "Quest/Dialogue/Rift đã có code; sửa roadmap còn ghi chưa triển khai. Willowmere mở đầu build, Sunscar trong Travel sau south_gate.",
        "Cập nhật Poise/KnockDown, flask 35–50% trong 2 s, kháng trần 77%, Spellguard chờ 7 s, lock 20/30 m và cây passive version 5.",
        "Web SFX có 140 preview và JSON review. Trạng thái source tách khỏi Done cá nhân; số đếm có manifest nguồn/hash, không tuyên bố đã chạy lại Unity."
      ]
    },
    {
      "date": "2026-10-10",
      "cats": [
        "character"
      ],
      "title": "Nhân vật Synty Sidekick và bộ trang bị mới",
      "items": [
        "Nhân vật đổi sang Synty Sidekick: thân, đầu, tóc và giáp là các mảnh gắn lên một bộ xương; chỉnh được dáng người (nam–nữ, gầy–to, cơ bắp), mặt, tóc, râu, màu da và tóc.",
        "Xoá toàn bộ giáp cũ; bộ mới 233 món từ bốn gói Knights, Sorcerers, Samurai, Viking: giáp thân, găng (tay + bàn tay), giày (chân + bàn chân), mũ và ô Side thay áo choàng (lưng, mặt, vai, hông, khuỷu, đầu gối).",
        "Trang Trang bị & nhân vật: chọn món ở lại, đổi tên, phòng thủ, bậc, che tóc, rồi xuất JSON cho AI.",
        "Trang chỉnh nhân vật chỉ có trong editor; bản build mặc theo look mặc định đã lưu."
      ]
    },
    {
      "date": "2026-10-07",
      "cats": [
        "character",
        "av"
      ],
      "title": "Cân bằng 40 skill bằng một công thức",
      "items": [
        "Mana, sát thương, hộ thuẫn và lượng hồi của mọi skill tính từ một công thức: mốc Holy Slash ≈ 40 sát thương mỗi kẻ cho 12 mana; vùng rộng đánh mỗi con ít hơn nhưng cả bầy nhiều hơn; skill có hồi chiêu đổi thời gian chờ lấy hiệu suất mỗi mana.",
        "Ngọc hỗ trợ chỉ gắn được vào skill nó thật sự có tác dụng (Chain chỉ cho đòn đánh một lần, Quick Recovery chỉ cho skill có hồi chiêu, Brutality chỉ cho sát thương vật lý của phép…).",
        "32 skill mới từ gói Top Down Effects và Lightning Circle; mỗi skill có icon và âm thanh riêng.",
        "Bảng số liệu, biểu đồ và danh sách skill hợp từng ngọc hỗ trợ: trang Cân bằng skill (nút ở đầu trang)."
      ]
    },
    {
      "date": "2026-10-04",
      "cats": [
        "story"
      ],
      "title": "Chốt kế hoạch cốt truyện: Burn the World Tree",
      "items": [
        "Cây Thế Giới Aelvar hút cạn hành tinh Eryth; Kata đốt nó sau 10 chương, mỗi chương một Rift ngẫu nhiên có boss.",
        "Phe Seedbound, 3 lựa chọn lớn, 3 kết thúc; hội thoại kiểu Sekiro.",
        "Mọi tên riêng bằng tiếng Anh: NPC hoàn điểm đổi tên thành The Unbinder.",
        "22 mục việc cần làm trong mục Cốt truyện & quest."
      ]
    },
    {
      "date": "2026-10-04",
      "cats": [
        "world"
      ],
      "title": "Willowmere: nền Terrain vẽ được",
      "items": [
        "Nền đất sinh bằng code đổi thành Unity Terrain với 7 lớp chất liệu Meadow, tô sẵn theo màu cũ; độ cao giữ nguyên nên mọi vật đứng yên chỗ.",
        "Đường, quảng trường, ruộng giờ là sơn trên terrain (bỏ ô đất của gói Kingdom).",
        "Cỏ chỉ mọc nơi sơn cỏ; phần vẽ tay được giữ khi dựng lại làng.",
        "Thêm đủ gói POLYGON Meadow/Forest (190 prefab, 28 lớp terrain) và chuyển vật liệu gói Nature sang URP."
      ]
    },
    {
      "date": "2026-10-04",
      "cats": [
        "world",
        "enemies"
      ],
      "title": "Làng Willowmere",
      "items": [
        "Thung lũng mở: đồi, sông, hồ có đảo, hố sụt, thác; 6 NPC có trạm + dân làng + người đi bộ.",
        "Ngày / đêm 24 phút; quái theo bầy ban ngày, đêm sinh thêm; quái đi lại và bỏ đuổi khi chạy xa; 8 lửa trại.",
        "Cỏ mọc quanh camera, sương mù xa thật hơn."
      ]
    },
    {
      "date": "2026-10-04",
      "cats": [
        "combat",
        "weapons"
      ],
      "title": "Nhảy chém theo hướng nhảy, tư thế đỡ chung, nhát đầu đại kiếm",
      "items": [
        "Chém khi đang nhảy lao theo hướng nhảy và bổ theo hướng đó (trước bổ thẳng xuống tại chỗ).",
        "Mọi vũ khí cận chiến đỡ bằng tư thế đỡ của kiếm đơn (người dùng chọn).",
        "Đại kiếm / kiếm có chắn hẹp: hitbox phủ cả lưỡi, nhát đầu không còn trượt (84/84 trường hợp).",
        "Thương: đòn nối giữ mục tiêu và đứng đúng cự ly thương; đòn bổ cuối trúng.",
        "F10: chỉnh hướng chém từng đòn bằng mắt, tự lưu.",
        "Katana: chân không lún xuống sàn trong đòn xoay; giày tăng tốc không làm sai clip chạy khi lock."
      ]
    },
    {
      "date": "2026-10-04",
      "cats": [
        "items",
        "ui",
        "character"
      ],
      "title": "Đồ rơi từng món, tự nhặt, đầu Crimson Gaze",
      "items": [
        "Nhiều món rơi ra lần lượt 0.5 s; vàng / vật liệu tự vào túi khi đi qua; dòng \"+ món\" ở mép phải.",
        "Rương vô tận trong Training Room để test đồ.",
        "Đầu mặc định mới Crimson Gaze; chân chạm đúng mặt đất ở mọi scene.",
        "Xoá Eldmoor (có bản sao lưu)."
      ]
    },
    {
      "date": "2026-10-03",
      "cats": [
        "combat",
        "enemies",
        "tech"
      ],
      "title": "Thương làm lại, lock-on, sửa lỗi quái",
      "items": [
        "Thương dùng gói 9CG Spear thay clip boss Valkyrie: từ lúc bấm tới lúc chém 0.01–0.41 s (trước 0.45–1.2 s).",
        "Lock-on: chuột dọc vẫn nghiêng camera; đổi mục tiêu bằng giữ chuột ngang 0.2 s.",
        "Katana: 2 đòn xoay trên không nhanh gấp đôi và trúng thật.",
        "Hết lỗi \"Collection was modified\" khi quái gọi đồng đội; hạng quái tính theo máu gốc.",
        "Song kiếm hơn 1 kiếm đúng +12.5% (23/23 ba lần).",
        "Hiệu ứng phép không hiện mà vẫn trúng (Goblin Shaman, Lightning Strike): đã sửa."
      ]
    },
    {
      "date": "2026-10-03",
      "cats": [
        "combat",
        "weapons",
        "items",
        "enemies",
        "av"
      ],
      "title": "Sửa song kiếm, cung, giáp, quái Eldmoor, âm thanh rơi",
      "items": [
        "Song kiếm hết trượt mục tiêu khoá: chỉnh hướng chém 4 đòn về giữa vùng trúng (đứng yên 0/104, di chuyển 0/104).",
        "Bỏ hẳn chiêu G (kĩ năng vũ khí) của mọi vũ khí.",
        "Cung: góc bắn bù trọng lực để tên đi qua đúng tâm ngắm (trước rơi dưới tâm, tới ~2.8 m ở 30 m khi kéo yếu).",
        "Giáp module: mỗi món có điểm 0–100 theo hình, tier theo điểm.",
        "Eldmoor có 17 quái thường trong 5 nhóm phía nam thị trấn.",
        "Âm thanh rơi: chỉ đồ xịn có tiếng, phát lần lượt từng món."
      ]
    },
    {
      "date": "2026-10-03",
      "cats": [
        "world",
        "enemies",
        "tech"
      ],
      "title": "Dọn scene, xoá boss Warden & Valkyrie",
      "items": [
        "Chỉ giữ Crimson Castle, Eldmoor, Training Room (+ Weapon Tuner); xoá Meadow, Boss Arena, Valkyrie Arena, Bone Throne, Hearthvale và scene demo — có bản sao lưu ngoài repo.",
        "Xoá boss Warden, Valkyrie, Bone Warden; giữ moveset Warden (8 boss lâu đài dùng) và Valkyrie cho boss sau này.",
        "ESC → Game → Travel: đi thẳng tới từng khu thay cho \"về hub\".",
        "Đỡ đòn đứng yên được chốt là tính năng.",
        "Bài kiểm parry giờ dùng Archdemon trong lâu đài: 14/14."
      ]
    },
    {
      "date": "2026-10-03",
      "cats": [
        "items",
        "character",
        "ui"
      ],
      "title": "Giáp = mảnh quần áo module",
      "items": [
        "Bỏ 96 base giáp cũ; 113 món mới lấy từ mảnh module của Fantasy Hero, mặc vào là thấy trên người.",
        "Áo kèm quần, găng kèm cả bộ tay + giáp vai, giày kèm bọc gối; mũ trùm ẩn tóc, mũ sắt kín thay cả đầu.",
        "Ô Cape mới; rơi ra đất chỉ hiện một mảnh chính; ô trống = da trần.",
        "Vũ khí đeo tự khớp lại khi mặc / tháo từng món."
      ]
    },
    {
      "date": "2026-10-03",
      "cats": [
        "character"
      ],
      "title": "Nhân vật chính: nữ Fantasy Hero (POLYGON)",
      "items": [
        "Bỏ Synty Sidekick; 53 ngoại hình ghép từ gói Modular Fantasy Hero.",
        "Dựng lại vũ khí, tay cầm, vỏ và mọi scene (trừ Eldmoor)."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "world"
      ],
      "title": "Vương quốc Eldmoor",
      "items": [
        "Thế giới demo của gói Fantasy Kingdom: 13 NPC, 4 lửa trại, mở cửa và nội thất lâu đài."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "ui"
      ],
      "title": "Túi đồ: click nhấc, chuột phải dùng",
      "items": [
        "Click trái nhấc món lên, click lần nữa để đặt; không cần giữ chuột.",
        "Chuột phải: mặc / dùng / lắp ngọc / cắt ngọc thô; bỏ nhấp đúp.",
        "Chuột phải lúc đang cầm món = đặt lại chỗ cũ."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "weapons",
        "tech"
      ],
      "title": "Scene chỉnh vũ khí (WeaponTuner)",
      "items": [
        "Chỉnh vị trí / hướng từng vũ khí ở 4 tư thế, chỉ cho 1 vũ khí hoặc cả loại, lưu là game dùng ngay.",
        "Chạy tại chỗ để xem lúc di chuyển, trục màu trên vũ khí, camera cận tay / lưng / hông."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "weapons"
      ],
      "title": "Chuôi kiếm vừa nắm tay",
      "items": [
        "Chuôi một tay 20–27 cm rút còn 15 cm, nắm tay sát chắn kiếm; lưỡi giữ nguyên.",
        "Kiếm hai tay chừa chỗ cho tay trái. Crimson Katana hết cầm \"tay không\"."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "weapons"
      ],
      "title": "Đeo vũ khí: song kiếm chéo X sau lưng",
      "items": [
        "Mọi vị trí đeo làm lại theo chỗ clip rút kiếm với tới.",
        "Tự khớp theo 14 ngoại hình (giáp, áo choàng, balo).",
        "Sửa: kiếm đơn / katana chĩa ngang ra sau, chuôi đại kiếm xuyên đầu, cung vuông góc lưng."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "ui",
        "items"
      ],
      "title": "Chuột phải tháo đồ đang mặc",
      "items": [
        "Túi đầy: cảnh báo đỏ + hộp chọn \"vứt ra đất\" hoặc \"giữ lại\"."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "items",
        "av"
      ],
      "title": "Hiệu ứng & âm thanh đồ rơi",
      "items": [
        "13 kiểu đồ rơi với cột sáng / hiệu ứng chạm đất; Divine có ánh sáng rơi từ trên.",
        "9 âm thanh rơi; kéo đồ ra ngoài túi = thả xuống đất (5 phút)."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "world",
        "items"
      ],
      "title": "Làng Hearthvale",
      "items": [
        "6 NPC: thợ rèn, thầy thuốc, bếp, tạp hoá, Hall of Memories, The Unbinder.",
        "Trang trại thời gian thực 8 khu; đồ vui có cơ chế thật."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "character"
      ],
      "title": "Cây passive 130 node",
      "items": [
        "3 nhánh, cụm vũ khí, 24 notable, 6 keystone; tab Passives."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "enemies"
      ],
      "title": "Quái Magic / Rare",
      "items": [
        "6 mod, tên + mod hiện trên đầu; thanh máu chỉ hiện sau khi bị đánh."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "items"
      ],
      "title": "Trang bị kiểu PoE2 & flask theo tier",
      "items": [
        "96 base giáp, Armour / Agility / Spellguard, 12 trang sức, 2 bộ vũ khí (Tab).",
        "Flask Nhỏ → Thượng Hạng, flask Magic, Thuỷ Tinh Thợ Thuốc."
      ]
    },
    {
      "date": "2026-10-02",
      "cats": [
        "character"
      ],
      "title": "Phép có loại sát thương + 3 support",
      "items": [
        "Brutality, Fire Conversion, Empowered Heavy; skill Fire Infusion."
      ]
    },
    {
      "date": "2026-10-01",
      "cats": [
        "items",
        "character"
      ],
      "title": "Luật đồ, chế tạo, nâng cấp, skill, flask theo GDD",
      "items": [
        "9 gem (4 gem riêng), rơi đồ GDD, độc nhất boss có chống xui.",
        "Nâng cấp Đá Rèn I–V có thất bại, quality, chuyển cấp.",
        "6 ô skill, support trong gem, level gem, Ngọc Thô / Đục / Mài; kĩ năng vũ khí G.",
        "Flask charge, lửa trại, chết / hồi sinh đầy flask."
      ]
    },
    {
      "date": "2026-10-01",
      "cats": [
        "character",
        "tech"
      ],
      "title": "Nhân vật & lưu game",
      "items": [
        "Level 1–100, 5 thuộc tính, bảng chỉ số, loại sát thương + kháng.",
        "Save JSON mang qua mọi scene; tab Character, thanh EXP, hiệu ứng lên level."
      ]
    },
    {
      "date": "2026-10-01",
      "cats": [
        "weapons"
      ],
      "title": "Catalog 347 vũ khí & bộ đòn kiếm đơn / thương",
      "items": [
        "Bỏ 3 vũ khí gen cũ; song kiếm = 2 kiếm catalog.",
        "Kiếm một tay ≤ 1.3 m; thương dùng clip của Valkyrie.",
        "Sửa: đỡ xong bị đơ 7.7 s."
      ]
    },
    {
      "date": "2026-10-01",
      "cats": [
        "items"
      ],
      "title": "Đồ rơi 3D",
      "items": [
        "Model 3D bay ra và nảy trên sàn, F nhặt; vũ khí nằm ngang bằng model catalog."
      ]
    },
    {
      "date": "2026-10-01",
      "cats": [
        "character",
        "ui"
      ],
      "title": "Quả cầu skill & icon low-poly",
      "items": [
        "Mọi ngọc skill là một quả cầu kính 3D; icon skill vẽ lại kiểu low-poly."
      ]
    },
    {
      "date": "2026-09-30",
      "cats": [
        "enemies",
        "world"
      ],
      "title": "Quái + 7 boss trong lâu đài",
      "items": [
        "26 loại quái, 30 quái đặt sẵn, 7 phòng boss phụ.",
        "Phòng boss + hồi sinh ở cửa; quái sống lại khi chết."
      ]
    },
    {
      "date": "2026-09-30",
      "cats": [
        "combat"
      ],
      "title": "Lock-on kiểu Sekiro & luật khựng mới",
      "items": [
        "Lock tầm ngắn, hất chuột đổi mục tiêu, Auto Target.",
        "Người chơi không bao giờ bị ngã; chỉ đòn quyết định mới làm khựng."
      ]
    },
    {
      "date": "2026-09-30",
      "cats": [
        "character",
        "ui"
      ],
      "title": "Ngọc skill kiểu PoE2 & túi 12×8",
      "items": [
        "5 ô skill + 2 lỗ rune; rơi từ quái và rương.",
        "Bản đồ phím mới (Q E R T C, chuột phải đỡ, Shift + trái đòn nặng)."
      ]
    },
    {
      "date": "2026-09-30",
      "cats": [
        "world",
        "av"
      ],
      "title": "Ánh sáng lâu đài \"thật\"",
      "items": [
        "Bỏ đèn giả, chỉ giữ nguồn sáng có vật phát sáng; 14 đèn gần nhất đổ bóng; lửa nhấp nháy."
      ]
    },
    {
      "date": "2026-09-29",
      "cats": [
        "world"
      ],
      "title": "Crimson Castle",
      "items": [
        "Bố cục rẽ nhánh sinh từ lưới, kiểm BFS, NPC cốt truyện, Archdemon."
      ]
    },
    {
      "date": "2026-09-29",
      "cats": [
        "combat",
        "ui"
      ],
      "title": "Nhảy, zoom camera, HUD mới",
      "items": [
        "Nhảy liền không khựng, bunny hop.",
        "Zoom kiểu Genshin; HUD cùng style túi đồ, khung quả cầu đá low-poly."
      ]
    },
    {
      "date": "2026-09-29",
      "cats": [
        "av",
        "tech"
      ],
      "title": "Hiệu ứng hạt, khử răng cưa, đo hiệu năng",
      "items": [
        "Thư viện FX theo sự kiện; MSAA 4x + SMAA; bản build benchmark."
      ]
    },
    {
      "date": "2026-09-28",
      "cats": [
        "combat",
        "world"
      ],
      "title": "Chân trượt & chân chìm",
      "items": [
        "Tốc độ animation theo tốc độ thật; đường meadow có collider khớp mặt."
      ]
    },
    {
      "date": "2026-09-27",
      "cats": [
        "character"
      ],
      "title": "Nhân vật chính: hiệp sĩ Synty Sidekick",
      "items": [
        "14 preset đổi trong game; vật liệu Toon."
      ]
    },
    {
      "date": "2026-09-26",
      "cats": [
        "character"
      ],
      "title": "Thử nghiệm Federica",
      "items": [
        "Tóc vật lý Cloth; sau đó đổi sang Sidekick."
      ]
    },
    {
      "date": "2026-09-22",
      "cats": [
        "tech"
      ],
      "title": "Khởi tạo project",
      "items": [
        "Song kiếm, Training Room, boss Warden, job bridge điều khiển editor."
      ]
    }
  ],

  notes: [
    {
      "title": "Phạm vi kiểm chứng · 10/10",
      "items": [
        "Đối chiếu source và asset đang có; không chạy Unity/probe mới trong lần cập nhật web này. Có code không đồng nghĩa đã cân bằng hoặc kiểm hết trong bản build.",
        "36 skill, 33 support, 41 prefab quái, 18 quest và 7 thế giới Rift là số đếm dữ liệu; thế giới khai báo chưa chắc đã mở được trong mọi tiến trình save.",
        "Bảng tiến độ dùng trạng thái công khai theo code. Nút Done và ghi chú cá nhân vẫn lưu riêng, không đổi số liệu tiến độ công khai.",
        "Ảnh gameplay cũ ghi rõ lịch sử; chưa có bộ ảnh gameplay Sidekick mới cho trang tổng quan."
      ]
    },
    {
      "title": "Cần làm tiếp",
      "items": [
        "Kiểm combat/fit trên Sidekick, loại mesh Resources không dùng khỏi build.",
        "Màn tiêu đề và hướng dẫn lần đầu; quest Runereader; nội dung các chương còn lại và kết thúc.",
        "Farm chưa tích hợp vào làng hiện tại; tier gear đang dựa số đỉnh, cần review bằng hình và cân bằng.",
        "Các công tắc test như bỏ yêu cầu thuộc tính và mở mọi ô skill vẫn mặc định bật trong CharacterStats; cần cấu hình release."
      ]
    },
    {
      "title": "Quy ước hiện tại",
      "items": [
        "Hiển thị 4 độ hiếm Normal / Magic / Rare / Unique; enum 6 hạng cũ vẫn giữ để đọc dữ liệu và save.",
        "Bỏ đai và charm; bỏ ô quần.",
        "Chuột phải là đỡ / deflect (không phải đòn nặng).",
        "Không có nỏ; không có trọng lượng.",
        "Flask hồi trong 2 giây theo dữ liệu hiện tại."
      ]
    },
    {
      "title": "Mục tiêu cân bằng ban đầu",
      "items": [
        "Quái thường chết sau 2–4 đòn nhẹ với đồ đúng cấp.",
        "Trận boss 2–4 phút; 3–8 lần thử cho boss chính.",
        "Sức mạnh: ~35% base + nâng cấp, ~35% affix, ~30% gem + passive.",
        "Rare 4 dòng đầu tiên khoảng boss thứ 2; độc nhất boss đầu sau 3–5 lần đánh lại."
      ]
    },
    {
      "title": "Câu hỏi thiết kế còn mở",
      "items": [
        "Boss và map từ chương 4; kẻ phản bội và các lựa chọn kết thúc.",
        "Mục tiêu thời gian boss, tỉ lệ drop/upgrade và giá trị affix cần playtest.",
        "Trang trại offline chưa chống chỉnh giờ tiến lên; nghề phụ và endgame còn mở."
      ]
    }
  ],

  gallery: [
    [
      "img/willow-village.jpg",
      "Willowmere — thị trấn và 7 con đường trên nền Terrain"
    ],
    [
      "img/willow-top.jpg",
      "Willowmere nhìn từ trên: sông, hồ có đảo, hố sụt, núi bao quanh"
    ],
    [
      "img/willow-sinkhole.jpg",
      "Hố sụt sâu 14 m ở đồng cỏ cao"
    ],
    [
      "img/willow-terrain-road.jpg",
      "Đường đất vẽ trên terrain, cỏ mọc hai bên"
    ],
    [
      "img/hero-head-crimson-gaze.jpg",
      "Ảnh lịch sử · Đầu Crimson Gaze: không mũ / vương miện / mũ trùm / mũ kín"
    ],
    [
      "img/castle-great-hall.jpg",
      "Ảnh lịch sử · Great Hall — quái Magic / Rare với tên và mod trên đầu"
    ],
    [
      "img/castle-gate.jpg",
      "Ảnh lịch sử · Gate Hall — lửa trại đầu tiên"
    ],
    [
      "img/castle-library.jpg",
      "Ảnh lịch sử · Library"
    ],
    [
      "img/castle-armory.jpg",
      "Ảnh lịch sử · Armory — hiệu ứng phép của quái"
    ],
    [
      "img/boss-archdemon.jpg",
      "Ảnh lịch sử · Crimson Archdemon trong Cathedral"
    ],
    [
      "img/boss-archdemon-2.jpg",
      "Ảnh lịch sử · Archdemon — đòn đập"
    ],
    [
      "img/castle-plan.jpg",
      "Sơ đồ Crimson Castle nhìn từ trên"
    ],
    [
      "img/hub-square.jpg",
      "Ảnh lịch sử · Hearthvale — quảng trường (scene đã gỡ 03/10)"
    ],
    [
      "img/hub-farm.jpg",
      "Ảnh lịch sử · Hearthvale — trang trại"
    ],
    [
      "img/hub-west.jpg",
      "Ảnh lịch sử · Hearthvale — phía tây"
    ],
    [
      "img/hub-east.jpg",
      "Ảnh lịch sử · Hearthvale — phía đông"
    ],
    [
      "img/hub-mine.jpg",
      "Ảnh lịch sử · Hearthvale — mỏ"
    ],
    [
      "img/loot-row.jpg",
      "Ảnh lịch sử · 13 kiểu đồ rơi"
    ],
    [
      "img/loot-divine.jpg",
      "Ảnh lịch sử · Đồ rơi Divine"
    ],
    [
      "img/ui-hud.jpg",
      "Ảnh lịch sử · HUD"
    ],
    [
      "img/ui-inventory.jpg",
      "Ảnh lịch sử · Túi đồ"
    ],
    [
      "img/ui-character.jpg",
      "Ảnh lịch sử · Bảng nhân vật"
    ],
    [
      "img/ui-passives.jpg",
      "Ảnh lịch sử · Cây passive"
    ],
    [
      "img/ui-skills.jpg",
      "Ảnh lịch sử · Tab Skills"
    ],
    [
      "img/ui-bag-full.jpg",
      "Ảnh lịch sử · Túi đầy khi tháo đồ"
    ],
    [
      "img/tool-weapon-tuner.jpg",
      "Ảnh lịch sử · Scene chỉnh vũ khí"
    ],
    [
      "img/gear-outfit.jpg",
      "Ảnh lịch sử · Bộ giáp module: giáp tấm, găng, giày, vương miện, áo choàng"
    ],
    [
      "img/gear-outfit-helm.jpg",
      "Ảnh lịch sử · Mũ sắt kín, áo da, giày giáp, áo choàng"
    ],
    [
      "img/ui-equipment-cape.jpg",
      "Ảnh lịch sử · Bảng trang bị có ô Cape"
    ],
    [
      "img/gear-helmets.jpg",
      "Ảnh lịch sử · 34 mũ"
    ],
    [
      "img/gear-bodies.jpg",
      "Ảnh lịch sử · 28 áo (kèm quần)"
    ],
    [
      "img/gear-capes.jpg",
      "Ảnh lịch sử · 14 áo choàng / balo"
    ],
    [
      "img/hero-default.jpg",
      "Ảnh lịch sử · Nhân vật Fantasy Hero: trước, ngang, sau"
    ],
    [
      "img/hero-looks.jpg",
      "Ảnh lịch sử · 53 ngoại hình"
    ]
  ],

  tech: [
    [
      "Engine",
      "Unity 6000.6.2f1, URP, Input System, Cinemachine 3"
    ],
    [
      "Nhân vật",
      "Synty Sidekick Humanoid, SidekickLook + ModularOutfit + SidekickDresser, shader Toon và bảng màu theo bộ"
    ],
    [
      "Animation",
      "Gói 9CG (song kiếm, kiếm, katana, thương, cung, phép), Massive GreatSword, Mixamo"
    ],
    [
      "Môi trường",
      "Synty POLYGON (Dungeon, Fantasy Rivals, Fantasy Kingdom, Nature, Meadow/Forest…), Unity Terrain, Craftpix"
    ],
    [
      "Hiệu ứng",
      "Hovl Studio, POLYGON Particle FX, shader riêng (orb chất lỏng, toon)"
    ],
    [
      "Nội dung gen AI",
      "Model Meshy, icon GPT Image, nhạc Lyria, SFX ElevenLabs"
    ],
    [
      "Quy trình",
      "Builder sinh scene / animator / dữ liệu; probe Play-mode tự kiểm + chụp ảnh; job bridge điều khiển editor"
    ]
  ],
};
