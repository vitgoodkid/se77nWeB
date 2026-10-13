# Drop Review v1 — hướng dẫn cho AI

File do trang `drops.html` (Project K / Đồ rơi) xuất: `project-k-drops-<thời gian>.json`, `schema = "whosnext.drop-review"`, `schemaVersion = 1`.

## Cấu trúc

| Trường | Ý nghĩa |
|---|---|
| `source.sha256` | Dấu của `drops-data.json` lúc xuất. Khác bản hiện tại = code game đã đổi tỉ lệ sau đó; đối chiếu từng mục `changed` với code trước khi áp. |
| `instructions` | Luật áp dụng (tiếng Anh), làm theo đúng thứ tự. |
| `summary` | Tổng số mục, số mục đã sửa, số ghi chú. |
| `warnings` | Các tỉ lệ phải cộng đủ 100% mà chưa đủ (đá rèn bậc thấp, hạng Rift Stone, hạng rune). Hỏi người dùng nếu còn cảnh báo. |
| `notes.general`, `notes.groups.<id>` | Ghi chú của người dùng: lý do sửa, hoặc thay đổi mà bảng chưa có ô (ví dụ món mới). Phải đọc và làm theo. |
| `groups[]` | Bảng: `id`, `title`, `code` (file + symbol chứa các số của bảng). |
| `entries[]` | Mỗi tỉ lệ một mục: `id` cố định (`<bảng>.<hàng>.<cột>`), `label` để đọc, `kind`, `code` (chỗ trong code), `baseline` (số trong code lúc xuất), `requested`, `changed`. |

## Kiểu giá trị

| `kind` | Dạng | Ví dụ | Trong C# |
|---|---|---|---|
| `chance` | hệ số 0–1 | `0.04` = 4% | `rng.NextDouble() < 0.04` |
| `range` | `[min, max]` số nguyên, gồm cả hai đầu | `[1, 3]` | `rng.Next(1, 4)` |
| `number` | hệ số thường | `5` | `5f` |
| `int` | số nguyên | `1` | `1` |
| `color` | `#rrggbb` | `#ff4238` | `new Color(1f, .26f, .22f)` |

## Áp vào game

1. Chỉ sửa các mục `changed: true` và những gì ghi chú yêu cầu. Không đổi số nào khác.
2. Sửa hằng số tại `code` (đa số trong `Assets/_Game/Scripts/Runtime/Items/WeaponStash.cs` — `LootDrops`; còn `World/SkillLoot.cs`, `Items/GearRunes.cs`, `Items/Flasks.cs`, `Items/RiftStones.cs`, `Enemies/MonsterMods.cs`, `World/LootFx.cs`, `World/LootChest.cs`, `World/DailyCampChest.cs`). Số viết thẳng trong code (không có hằng số) thì đặt tên hằng số khi sửa.
3. Đồ quest: sửa `drop N` (phần trăm) trong `Assets/_Game/Resources/Story/*.txt`.
4. Tỉ lệ đang là chắc chắn (100%) mà người dùng hạ xuống: thêm lượt tung mới, ghi rõ trong báo cáo.
5. Cập nhật `Documentation/GDD/DoRoi.md` và AGENTS.md; tạo lại `public/games/project-k/drops-data.json` của se77nWeB theo số mới (script ở repo game: `Documentation/Tools/make_drops_data.py` — sửa số trong script rồi chạy `python make_drops_data.py <se77nWeB>/public/games/project-k/drops-data.json`).
6. Compile, kiểm một đường rơi đồ trong Play (một phiên test), báo kết quả thật.
