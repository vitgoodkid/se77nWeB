# Drop Review v2 — hướng dẫn cho AI

File do trang `drops.html` (Project K / Đồ rơi) xuất: `project-k-drops-<thời gian>.json`, `schema = "whosnext.drop-review"`, `schemaVersion = 2`.

## Cơ chế trong game (từ 2026-10-13, kiểu PoE2)

1. Vàng luôn rơi, tính riêng (`LootDrops.Gold`).
2. Ngoài vàng, mỗi lần giết có **số lượt rơi** trung bình theo loại quái (`LootTable.Rolls`; phần lẻ là xác suất thêm một lượt), nhân Item Quantity của mod quái và Rift.
3. Mỗi lượt **chọn một bậc** T1–T6 theo `LootTable.TierWeight`; bậc T3 trở lên nhân thêm `1 + Item Rarity` (mod + Rift + `LootTable.RankRarity` của loại quái).
4. Rồi **chọn một món** trong bậc đó theo trọng số của món (`LootTable.Entries[].weight`), chỉ trong các món loại quái này được rơi (`minSource`) và (Rift Stone) chỉ trong Rift.
5. Bậc của món theo **tác dụng** của nó, quyết định cả độ hiếm lẫn màu nhãn/cột sáng/tiếng khi rơi (`LootFx.KindOf(LootTier)`; `LootTable.TierOf` cho từng id).

## Cấu trúc file

| Trường | Ý nghĩa |
|---|---|
| `source.sha256` | Dấu của `drops-data.json` lúc xuất. Khác bản hiện tại = code game đã đổi; đối chiếu từng mục `changed` với code trước khi áp. |
| `instructions` | Luật áp dụng (tiếng Anh). |
| `summary`, `warnings` | Số mục, số đã sửa, số ghi chú; cảnh báo (hạng Rift Stone ≠ 100%, bậc có trọng số mà không còn món…). |
| `notes.general`, `notes.groups.<id>` | Ghi chú của người dùng — đọc và làm theo. |
| `groups[]` | Bảng: `id`, `title`, `code` (file + symbol). |
| `entries[]` | Mỗi số một mục: `id` cố định `<bảng>.<hàng>.<cột>`, `label`, `kind`, `code`, `baseline`, `requested`, `changed`. Bảng `items`: hàng = khoá của món trong `LootTable.Entries`, cột `tier` / `weight` / `from` / `count`. |

## Kiểu giá trị

| `kind` | Dạng | Ví dụ | Trong C# |
|---|---|---|---|
| `chance` | hệ số 0–1 | `0.04` = 4% | `0.04f` |
| `range` | `[min, max]` số nguyên, gồm cả hai đầu | `[1, 3]` | `rng.Next(1, 4)` / `countMin = 1, countMax = 3` |
| `number` | hệ số hoặc trọng số | `5` | `5f` |
| `choice` | tên enum | `"Mythic"`, `"Boss"` | `LootTier.Mythic`, `LootTable.Source.Boss` |
| `color` | `#rrggbb` | `#ff4238` | `new Color(1f, .26f, .22f)` |

## Áp vào game

1. Chỉ sửa các mục `changed: true` và những gì ghi chú yêu cầu.
2. Bảng rơi ở `Assets/_Game/Scripts/Runtime/Items/LootTable.cs`. Đổi bậc một món thì đổi cả `LootTable.TierOf` cho id của nó (nhãn, cột sáng, tiếng theo bậc).
3. Đồ quest: `drop N` trong `Assets/_Game/Resources/Story/*.txt`. Vàng, Rift Stone, bình: file ghi ở `code`.
4. Món mới hoặc luật mới mà code chưa có: thêm vào, ghi rõ trong báo cáo.
5. Sau khi sửa: chạy `Whosnext.EditorTools.DropsDataExport.Run` (ghi lại `drops-data.json` của se77nWeB từ code), `Whosnext.EditorTools.LootSimProbe.Run` (20.000 lần giết mỗi loại quái → `Temp/WhosnextJobs/loot_sim.txt`), cập nhật `Documentation/GDD/DoRoi.md` + AGENTS.md, compile, kiểm một lần giết trong Play (`LootPlayProbe.Run` sau `MinimapProbe.PlayWillowmere`), rồi push se77nWeB.
