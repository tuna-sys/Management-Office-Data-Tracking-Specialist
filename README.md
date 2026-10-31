# L-Incentive — quản lý lao động và thưởng cục bộ

Đặc tả cập nhật ngày 12/10/2026: [Đọc bản đặc tả đầy đủ](docs/DAC_TA_HE_THONG_CAP_NHAT_2026-10-12.md).

Ứng dụng local mở thẳng Tổng quan, không cần đăng nhập. Hỗ trợ hồ sơ và lịch sử tái tuyển, kiểm tra nghỉ việc, chính sách 7 mốc, sửa dự thảo/duyệt/khóa thưởng, nhật ký và nhập Excel qua bước xem trước.

**Xác minh ngân hàng chưa kết nối. Mọi lệnh chi được chặn cho đến khi có bằng chứng thật. Duyệt/khóa thưởng không có nghĩa là đã chuyển tiền.**

## Chạy cục bộ

Sao chép `.env.example` thành `.env` nếu chưa có, rồi kiểm tra `DATABASE_URL`. App chỉ kết nối URL được cấu hình; nó không tự chọn database preview, tạo schema hoặc chạy migration khi khởi động.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Mở http://127.0.0.1:3000 để vào thẳng Tổng quan. Không có tài khoản, mật khẩu hay cookie phiên. Nhật ký mới ghi “Người dùng local”. API giữ bảo vệ host local và request ghi cùng nguồn. Không dùng bản này làm dịch vụ công khai.

```powershell
npm test
npm run test:integration
npm run test:backup
npm run build
npm start
```

`DATABASE_URL` trong `.env` trỏ tới DB SQLite duy nhất của môi trường đang chạy. Mặc định local là `file:./dev.db`, tương ứng `prisma/dev.db`. Không đặt URL sang file preview hoặc dùng cùng một file SQLite đồng thời ở nhiều môi trường.

## Sao lưu và kiểm tra khôi phục CSDL (SQLite)

Hệ thống hỗ trợ sao lưu online qua cơ chế `VACUUM INTO` của SQLite và kiểm thử khôi phục độc lập:

```powershell
# Sao lưu CSDL hiện tại (tạo snapshot nguyên tử kèm metadata checksum <backup>.meta.json)
npm run db:backup

# Kiểm tra khôi phục thử nghiệm trên môi trường độc lập (.local/restore-test), đối soát checksum & PRAGMA
npm run db:backup:verify

# Chạy bộ test tự động quy trình sao lưu & khôi phục (sử dụng DB giả lập)
npm run test:backup
```

* Quy tắc đường dẫn:
  - `DATABASE_URL`: Đường dẫn tương đối tính từ thư mục chứa schema (`prisma/`) theo chuẩn Prisma của dự án.
  - Tham số `--db`: Đường dẫn file chỉ định trực tiếp; đường dẫn tương đối tính từ thư mục chạy lệnh (`process.cwd()`).
* Quy tắc an toàn:
  - Chống ghi đè: Không bao giờ ghi đè bản sao lưu có trước nếu trùng tên; file metadata luôn có đuôi `.meta.json` (ví dụ `backup.db.meta.json` hoặc `custom.sqlite.meta.json`).
  - Kiểm chứng khôi phục: Thư mục tạm kiểm thử được tạo riêng cho từng phiên và tự động dọn dẹp trong `finally`; chỉ kết luận `PASS` khi có đầy đủ metadata gốc và cấu trúc SQLite đạt chuẩn; thiếu metadata trả về `WARN`.
  - Lưu ý vận hành: CSDL hiện chạy ở chế độ delete journal mặc định. Lệnh sao lưu giữ Shared Lock trong lúc đọc, các thao tác ghi đồng thời có thể phải chờ ngắn; nên ưu tiên chạy sao lưu định kỳ vào thời điểm ít thao tác.

## Quản lý Migration

Kiểm tra migration bằng `npm run db:migrate:status`; tạo migration trong môi trường phát triển bằng `npm run db:migrate:dev`; triển khai migration đã được review bằng `npm run db:migrate:deploy`. Cả 5 thư mục migration hiện có trong `prisma/migrations` đều đã có đầy đủ file `migration.sql` chuẩn. Tuy nhiên, vẫn cần đối chiếu baseline trước khi áp dụng trên DB đã có dữ liệu sản xuất; luôn chạy `npm run db:backup` trước khi thực hiện bất kỳ thao tác migration nào. Không chạy `db:push` hoặc `migrate deploy` trên DB thật cho tới khi baseline và backup/restore được xác minh.

Kiểm thử integration dùng CSDL giả lập riêng trong `.local/qa-*` qua `DATABASE_URL` và cổng loopback 3101. Không nhập thử vào DB thật. Các lệnh chạy ứng dụng chỉ bind localhost.

Các thay đổi code không tự chạy migration hay thay đổi database hiện có.

## Cơ chế nạp kết hợp và quy tắc phân loại trùng (Cập nhật 30/10/2026)

### 1. Cơ chế nạp đa file thuần RAM (In-Memory Multi-File Preview)
- **Hỗ trợ nạp 2 file đồng thời**: API `POST /api/excel-engine/import` hỗ trợ nhận đồng thời file danh sách tổng và file thưởng qua `formData` (`file` và `secondaryFile`/`bonusFile`, hoặc trường `files` đa tệp).
- **Giới hạn nghiêm ngặt tối đa 2 file**: Cả API và giao diện đều áp đặt giới hạn nhận tối đa đúng 2 file (một file `DS_TONG` và một file `DS_THUONG`). Nếu gửi vượt quá 2 file, API lập tức từ chối với HTTP 400.
- **Không sinh tệp tạm trên đĩa**: Quá trình hợp nhất các Sheet được thực hiện thuần túy trong bộ nhớ RAM của tiến trình Node.js (`book.Sheets[sName] = extraBook.Sheets[sName]`). Tuyệt đối không ghi file tạm dung lượng lớn trên đĩa (tránh phình tệp XML ~451 MB và nguy cơ cạn kiệt bộ nhớ đệm).
- **Tự động nhận diện luồng COMBINED**: Tự động nhận diện sheet hồ sơ (`DS_TONG`) và sheet thưởng (`DS_THUONG`), nạp lượt tuyển hợp lệ vào `people` trong RAM rồi nối trực tiếp sang danh sách thưởng trước khi trả về kết quả xem trước (`confirm: false`).
- **Bảo toàn giới hạn tải lên**: Mỗi file được kiểm tra độc lập theo ngưỡng tối đa 50 MB; mã băm `previewFingerprint` được tính trực tiếp từ dữ liệu các ô của cả hai sheet.

### 2. Luồng giao diện Preview → Xác nhận (Commit) an toàn
- **Giao diện chọn 2 file**: Component Dragger tại trang `/excel-tools` hỗ trợ chọn cùng lúc tối đa 2 file Excel (`maxCount={2}`), hiển thị danh sách tên và dung lượng từng file đã nạp.
- **Xem trước (Preview, `confirm: false`)**: Gửi 2 file lên API để phân tích, tính toán các chỉ số liên kết và trả về `previewFingerprint` định danh trạng thái dữ liệu các ô. Trạng thái xem trước tuyệt đối **không ghi** vào CSDL (`dev.db`).
- **Xác nhận ghi (Commit, `confirm: true`)**: Nút xác nhận gửi lại đúng 2 file đang chờ (`pendingFiles[0]` và `pendingFiles[1]`) cùng mã `previewFingerprint`. Nếu dữ liệu ô trong bất kỳ file nào bị thay đổi sau lần quét xem trước, API sẽ lập tức chặn với mã HTTP 409 Conflict yêu cầu quét lại.

### 3. Bộ đếm liên kết thưởng và định nghĩa chỉ số
- **Phân định rõ ràng giữa tìm thấy lượt PV và sẵn sàng nạp**:
  - `matchedAssignmentCount`: Số dòng thưởng tìm thấy lượt phỏng vấn phù hợp (khớp CCCD + Ngày PV + Công ty).
  - `linkedBonusCount`: Chỉ tăng khi dòng thưởng tìm thấy lượt PV **và vượt qua toàn bộ các bước kiểm tra tiếp theo** (không bị chặn bởi trùng lặp nội bộ, đợt thưởng đã khóa, v.v.). Đây là số lượng thưởng đã nối thực sự sẵn sàng nạp hoặc bổ sung.
  - `unlinkedBonusCount`: Số dòng thưởng không tìm thấy lượt PV khớp ngày nhưng vượt qua các bước kiểm tra để nạp thành bản ghi dự thảo chờ đối chiếu.
- **Phân loại chi tiết các nhóm cần xét duyệt (`reviewBreakdown`)**:
  - `diffCompanyCount`: Trùng ngày PV tại hai công ty (khác nhà máy).
  - `codeMismatchCount`: Khác mã nhân viên trong cùng công ty.
  - `unlinkedInterviewCount`: Chưa có lượt PV khớp ngày.
  - `identityMismatchCount`: Sai lệch danh tính (khác họ tên).
  - `internalDuplicateCount` + `existingBonusCount`: Trùng lặp nội bộ hoặc bản thưởng của đợt đã tồn tại trong CSDL.
- **Giao diện động hoàn toàn**: Toàn bộ chỉ số và lời giải thích hiển thị trực tiếp từ kết quả quét thực tế, tuyệt đối không chứa số liệu ghi cứng (hardcoded), đảm bảo tính bền vững và khả năng bảo trì khi thay đổi file dữ liệu.

### 4. Bộ quy tắc đối soát và phân loại trùng
- **Trùng ngày PV tại hai công ty (khác nhà máy)**: Khi cùng số CCCD và cùng ngày PV nhưng công ty ghi nhận khác nhau (409 trường hợp trên bộ dữ liệu mẫu), hệ thống phát cảnh báo và giữ nguyên cả hai bản ghi độc lập để đối chiếu; tuyệt đối không tự ý gộp hoặc ghi đè.
- **Khác mã theo công ty**: Khác mã nhân viên do khác công ty không bị coi là lỗi. Chỉ khi trùng công ty và lượt PV mà mã nhân viên không khớp mới phát cảnh báo `Khác mã theo công ty`, đưa vào danh sách chờ xét duyệt (296 trường hợp trên bộ dữ liệu mẫu, bao gồm các mã chỉ khác nhau giữa dấu chấm `.` và dấu phẩy `,`).
- **Sai lệch danh tính**: Cùng số CCCD nhưng khác họ tên (7 trường hợp trên bộ dữ liệu mẫu) sẽ bị chặn và cảnh báo sai lệch danh tính, giữ riêng để đối soát thủ công.
- **Bảo toàn nguyên bản CCCD**: Không tự động đệm số 0 vào đầu các CCCD thiếu chữ số; yêu cầu đối chiếu trực tiếp với bản gốc.
- **Khác ngày PV**: Bản thưởng không tìm thấy lượt tuyển khớp ngày (57 trường hợp trên bộ dữ liệu mẫu) được giữ ở trạng thái chưa liên kết để người dùng đối soát thủ công.

### 5. Kiểm thử tự động
- `tests/dual-file-combined.cjs`: Kiểm thử toàn diện các kịch bản luồng nạp 2 file:
  1. Chặn vượt quá 2 file với HTTP 400.
  2. Xem trước 2 file thuần RAM trả về `COMBINED`, kiểm tra dòng tìm thấy lượt PV nhưng bị loại ở bước kiểm tra thưởng tiếp theo không bị tính sai vào `linkedBonusCount`, phân loại chuẩn vào `reviewBreakdown` và đảm bảo 0 bản ghi bị ghi vào DB.
  3. Chặn commit sai fingerprint với HTTP 409 Conflict.
  4. Thực hiện commit thành công với cùng 2 file và cùng `previewFingerprint`.
  5. Chặn commit khi nội dung ô trong file bị thay đổi.
- `tests/duplicate-maintainability.cjs`: Kiểm thử 5 quy tắc bất biến về khử trùng và tính bảo trì của hệ thống.
- `tests/codex-review-fixes.cjs`: Kiểm thử hồi quy trực tiếp cho 3 lỗi mã và kiểm chứng ma trận chuẩn hóa trạng thái (Canonical Mapping).
- Toàn bộ các file test trên đã được tích hợp vào lệnh chuẩn `npm test`.

## Chuẩn hóa trạng thái, vá lỗi hồi quy và bằng chứng đối soát thực tế (Cập nhật 31/10/2026)

### 1. Chuẩn hóa trạng thái nguồn (Canonical Status Mapping)
- **Tập tin mới**: `src/lib/status-mapping.ts`
- **Tác dụng**:
  - Khắc phục triệt để tình trạng phân mảnh danh mục (`Đỗ - ko tính` vs `Đỗ - Ko tính`, `Hết Phí` vs `Hết phí`) và gán bừa cờ nghiệp vụ khi nạp dữ liệu Excel.
  - Ma trận thuộc tính nghiệp vụ chính xác:
    + `Bỏ KSK` ➔ `Bỏ khám sức khỏe`: `category: STOP`, `endsAssignment: true` (kết thúc đợt tuyển).
    + `DS Đen` ➔ `Danh sách đen`: `category: STOP`, `endsAssignment: true`, `warnsDuplicate: true` (kết thúc đợt tuyển và cảnh báo nghiêm ngặt khi có hồ sơ mới).
    + `Chuyển FIH` ➔ `Chuyển xưởng`: `category: STOP`, `endsAssignment: true` (kết thúc đợt tại xưởng ban đầu để chuyển cơ sở).
    + `Chưa ĐT` ➔ `Chưa đào tạo`: `category: NEW`, `endsAssignment: false` (tiếp tục quy trình đào tạo).
    + `Đỗ - ko tính` ➔ `Đỗ - Ko tính`: `category: SOURCE`, `endsAssignment: false` (trúng tuyển không tính thưởng).
    + `Hết Phí` ➔ `Hết phí`: `category: STOP`, `endsAssignment: true` (kết thúc hưởng phí).
  - **Bảo toàn nguyên bản**: Chuỗi gốc từ file nguồn được lưu 100% trong snapshot và lịch sử sự kiện (`AssignmentEvent`) để đối soát, nhưng CSDL chuẩn hóa thống nhất theo `LaborStatus.name` và `statusId`.

### 2. Khắc phục lỗi mã trong luồng Import Excel & Đồng bộ phiên làm việc
- **Tập tin chỉnh sửa**: `src/app/api/excel-engine/import/route.ts`, `src/lib/duplicate-check.ts` và `src/lib/import-review.ts`
- **Chi tiết các điểm sửa**:
  1. **Khử Race Condition tạo trùng STK (`BankAccount`) & Chuẩn hóa định dạng toàn phiên**:
     - *Vấn đề cũ*: Nhánh `smartMerge` trong DS_TONG thực hiện `findFirst` + `create` inline bên trong `updateTasks` (vốn chạy song song theo lô qua `Promise.all`). Khi một công nhân có 2 lượt phỏng vấn mang cùng STK, cả 2 tác vụ chạy song song đều thấy STK chưa tồn tại và tạo ra 2 bản ghi `BankAccount` trùng nhau. Đồng thời khóa khử trùng bị cọc cạch giữa hai sheet (`workerId:accountNumber` vs `workerId|accountNumber`).
     - *Giải pháp mới*:
       + Khởi tạo cơ chế quản lý STK cấp phiên (`sessionScheduledBankKeys`, `sessionBanksToCreate`, `sessionBankUpdates`) dùng chung cho cả DS_TONG và DS_THUONG.
       + Thống nhất định dạng khóa duy nhất toàn hệ thống: `${workerId}:${accountNumber}`.
       + Khi gặp STK mới: thêm vào `sessionScheduledBankKeys`, đẩy vào `sessionBanksToCreate`, đồng thời cập nhật ngay lập tức vào in-memory `worker.bankAccounts` để các dòng kế tiếp của cùng công nhân nhận biết ngay.
       + Loại bỏ hoàn toàn mọi thao tác truy vấn và tạo `BankAccount` inline ra khỏi `updateTasks` / `Promise.all`.
       + Tại pha Commit: nạp theo lô an toàn bằng `prisma.bankAccount.createMany({ skipDuplicates: true })`.
  2. **Ràng buộc nghiệp vụ Danh sách đen (Blacklist) & Chuẩn hóa "Chưa đào tạo"**:
     - *Vấn đề cũ*: `isBlacklistAssignment` chưa từng được gọi trong `route.ts`. Khi một ứng viên có lượt tuyển trước thuộc "DS Đen", hàm `isActiveAssignment` trả về `false` (vì kết thúc đợt) dẫn tới việc hệ thống cho phép tuyển lại bình thường. Đồng thời `splitImportReview` chưa nhận diện Danh sách đen là lỗi trùng lặp nghiêm ngặt. Ngoài ra trạng thái "Chưa đào tạo" từng bị dính regex `/đào tạo/` dẫn tới bị coi là đang làm việc.
     - *Giải pháp mới*:
       + Bổ sung kiểm tra `isBlacklistAssignment(a, statuses)` ngay khi duyệt `old.assignments` trong `processDsTongSheet`. Nếu phát hiện ứng viên thuộc Danh sách đen, hệ thống từ chối tuyển mới, tăng `duplicateCount` và ghi lỗi rõ ràng: `Dòng X: Ứng viên CCCD ... thuộc Danh sách đen (...), không đủ điều kiện tuyển dụng.`.
       + Bổ sung kiểm tra Danh sách đen vào `assertReviewProfile` để bảo vệ đồng bộ cả luồng duyệt hồ sơ sau kiểm tra trùng.
       + Cập nhật `splitImportReview` để nhận diện các dòng chứa `Danh sách đen|DS Đen` là `duplicate` với `kind: 'BLACKLIST'`.
       + Khẳng định `isActiveAssignment` với `Chưa đào tạo` / `Chưa ĐT` luôn trả về `false`, không chặn vô cớ khi ứng viên chuyển sang nhà máy mới.
  3. **Khôi phục chức năng cập nhật tên ngân hàng trong Smart Merge DS_THUONG**:
     - *Vấn đề cũ*: Khi tài khoản ngân hàng đã tồn tại nhưng tên ngân hàng đang là rỗng hoặc "Chưa xác định", nếu dòng mới có tên ngân hàng cụ thể thì hệ thống không thực hiện cập nhật.
     - *Giải pháp mới*: Thu thập các yêu cầu cập nhật tên ngân hàng vào `sessionBankUpdates` và thực thi `prisma.bankAccount.update` ở pha commit cho cả DS_TONG và DS_THUONG.
  4. **Chặn toàn diện trường hợp nạp nhiều sheet cùng loại (Fail-Fast HTTP 400)**:
     - *Vấn đề cũ*: Điều kiện kiểm tra cũ chỉ kích hoạt khi `matchingTongSheets.length >= 2 && matchingBonusSheets.length === 0`. Nếu người dùng nạp file 1 có cả Tổng + Thưởng và file 2 có Thưởng thì sheet Thưởng thứ 2 bị âm thầm bỏ qua.
     - *Giải pháp mới*: Tách biệt 2 kiểm tra độc lập: nếu `matchingTongSheets.length > 1` hoặc `matchingBonusSheets.length > 1`, hệ thống từ chối ngay lập tức với **HTTP 400** kèm danh sách các sheet trùng tên loại.
  5. **Bảo toàn chuỗi trạng thái nguồn gốc trong lịch sử sự kiện (`AssignmentEvent`)**:
     - *Vấn đề cũ*: `eventsToCreate` chỉ lưu trạng thái chuẩn hóa và ghi chú mặc định, chuỗi thô nguồn chưa được ghi vào nhật ký sự kiện.
     - *Giải pháp mới*: Mỗi khi có sự chuẩn hóa trạng thái, trường `note` của `AssignmentEvent` được ghi rõ: `Import Excel (${fileName} - ${targetSheetName} dòng #${e.row}): Trạng thái nguồn "${rawStatus}" -> chuẩn hóa "${assignment.status}"` để phục vụ đối soát và kiểm toán.
  6. **Chống đếm thiếu dòng lỗi khi trùng số dòng giữa 2 sheet**:
     - *Vị trí*: `buildReviewBreakdown`, `combinedReview` và `splitImportReview`.
     - *Cơ chế*: Thêm tiền tố định danh sheet vào dòng lỗi (`[DS_TONG:row]` vs `[DS_THUONG:row]`), hàm `splitImportReview` phân giải chuỗi có tiền tố và gom dòng theo khóa `${sheet}:${row}`.
     - *Tác dụng*: Nếu cả 2 sheet cùng có lỗi ở dòng 5, hệ thống đếm đủ 2 dòng lỗi độc lập, không bị ghi đè chỉ số dòng trong `Set`.

### 3. Quy trình kiểm thử & Đo đạc Benchmark trên bản sao nhất quán
- **Tập tin kiểm thử**: `scratch/test-full-commit-on-replica.cjs` và `tests/codex-review-fixes.cjs`
- **Cơ chế an toàn & Đối soát toàn diện**:
  - Tạo bản sao SQLite nhất quán bằng `VACUUM INTO` qua `node:sqlite` (an toàn tuyệt đối với chế độ WAL, không sót transaction chưa checkpoint).
  - Cô lập hoàn toàn môi trường chạy thử: `LOCAL_IMPORT_SOURCE_DIR` và `LOCAL_IMPORT_RECOVERY_DIR` trỏ vào thư mục tạm `sandbox-commit-...` độc lập, tự động dọn dẹp sạch sẽ sau khi hoàn tất.
  - **Kiểm chứng biến động thư mục bằng SHA-256 Manifest đệ quy**: Ghi nhận toàn bộ đường dẫn tương đối, dung lượng và mã băm SHA-256 của từng file trong `.local/source-imports` và `.local/import-recovery` trước khi chạy; sau khi chạy đối chiếu bằng `assert.deepStrictEqual` để phát hiện và khẳng định không có bất kỳ thay đổi, thêm bớt hay ghi đè nào trên thư mục ứng dụng chính.
  - **Đối soát toàn diện 100% liên kết thưởng - lượt tuyển**: Quét qua toàn bộ 60.471 bản ghi thưởng có liên kết theo thứ tự phân trang ổn định (`orderBy: { id: "asc" }`), kiểm tra khớp WorkerId, khớp Công ty/Nhà máy (`sameFactory`), khớp Ngày PV chuẩn hóa (`dateKey`) và khớp Mã nhân viên (`identityText` chuẩn hóa Unicode NFC), đảm bảo 0 sai lệch.
  - Bổ sung assertion nghiêm ngặt trên HTTP status `200`, `success === true`, tăng trưởng thực tế trên DB replica, xác minh sự tồn tại của AuditLog biên nhận và file snapshot trong sandbox.
  - Xuất log bằng chứng thực tế tại thư mục `outputs/` với đầy đủ timestamp và số liệu đối soát chi tiết.

#### Bảng kết quả chạy thử thực tế trên 2 file thật (122.815 dòng) - Lưu tại `outputs/benchmark-evidence-1793411956094.json`:
| Hạng mục đối soát | Trước Commit | Sau Commit | Biến động (+/-) | Kết quả kiểm toán & Đối soát chi tiết |
|---|---|---|---|---|
| **Công nhân (`Worker`)** | 50.385 | 50.392 | +7 | 7 hồ sơ ứng viên mới nạp từ DS_TONG |
| **Lượt tuyển (`WorkAssignment`)** | 0 | 61.178 | +61.178 | Toàn bộ 61.178 lượt tuyển được nạp hợp lệ |
| **Bản thưởng (`BonusRecord`)** | 61.452 | 61.452 | +0 | Bảo toàn số lượng bản thưởng gốc |
| **Bản thưởng đã nối (`linked`)** | 0 | 60.471 | +60.471 | Đã đối soát 100% (60.471 / 60.471 bản ghi):<br>• **WorkerId**: 60.471 / 60.471 khớp (0 sai lệch)<br>• **Công ty**: 60.471 / 60.471 khớp (0 sai lệch)<br>• **Ngày PV**: 60.471 / 60.471 khớp chuẩn hóa ngày (0 sai lệch)<br>• **Mã NV**: 59.910 khớp Unicode, 561 thiếu 1 bên (0 sai lệch) |
| **Nhật ký kiểm toán (`AuditLog`)** | 84.684 | 145.158 | +60.474 | Ghi nhận đầy đủ biên nhận commit và vết xử lý |
| **Thư mục ứng dụng (`.local`)** | 115 files | 115 files | 0 | SHA-256 Manifest đồng nhất 100% trước và sau chạy |
| **Thời gian quét Preview** | — | — | 100,62 giây | Quét 122.815 dòng (53,1 MB dữ liệu) |
| **Thời gian Commit DB Replica** | — | — | 156,35 giây | Batch commit an toàn trên SQLite replica |

### 4. Vá các lỗi phát hiện qua phản biện Codex (Cập nhật bổ sung 31/10/2026)
1. **[P1] Khắc phục va chạm tên sheet `Sheet1` khi nạp 2 file**:
   - *Vị trí*: `src/app/api/excel-engine/import/route.ts` (dòng 534-555).
   - *Cơ chế*: Duy trì bảng ánh xạ `file2SheetMap = new Map<string, string>()` ghi nhận chính xác `originalSheetName -> targetSheetName`, sử dụng vòng `while (book.Sheets[targetSheetName])` để đổi tên tránh trùng lặp (`Sheet1_2`, `Sheet1_3`...), và tra cứu trực tiếp bằng `file2SheetMap` thay vì kiểm tra `book.Sheets[info2.bonusSheet]`.
   - *Tác dụng*: Đảm bảo sheet thưởng của file thứ 2 không bao giờ bị trỏ nhầm về sheet tổng của file thứ nhất, khắc phục triệt để lỗi "Thiếu tháng thưởng" khi 2 file có cùng tên sheet.
2. **[P2] Chuẩn hóa trạng thái áp dụng đồng bộ cho cả lượt tuyển mới và Smart Merge**:
   - *Vị trí*: `src/app/api/excel-engine/import/route.ts` (dòng 791 & 933-943).
   - *Cơ chế*: Di chuyển logic chuẩn hóa `resolveCanonicalStatus(rawStatus)` lên ngay sau `parseImportRow` cho từng dòng Excel. Khi cập nhật trạng thái trong Smart Merge, đồng thời reset `assignmentUpdates.statusId = null` để hàm `assignmentRelations` gán chính xác `statusId` tương ứng từ danh mục (`LaborStatus`). Đồng thời ghi sự kiện `AssignmentEvent` lưu vết cả chuỗi gốc và trạng thái chuẩn hóa.
   - *Tác dụng*: Đảm bảo database luôn lưu đúng tên chuẩn ("Bỏ khám sức khỏe") và `statusId` danh mục hợp lệ, không còn trường hợp lưu chuỗi thô ("Bỏ KSK") khi cập nhật đợt tuyển cũ.
3. **Bộ test hồi quy mở rộng**:
   - `tests/codex-review-fixes.cjs`: Nâng cấp lên **10/10 test hồi quy**, bổ sung test chống va chạm `Sheet1` giữa 2 file (Fix 9) và test cập nhật chuẩn hóa `status` + `statusId` trong Smart Merge (Fix 10). Toàn bộ 10 test đều đạt, `npm test` kết thúc mã 0.

Bản README cũ được giữ để đối chiếu tại [docs/README_V2_TRUOC_CHINH_SUA.md](docs/README_V2_TRUOC_CHINH_SUA.md); không dùng các tuyên bố cũ về xác minh ngân hàng, ngày công hay Internet Banking làm bằng chứng chức năng đã hoàn thành.
