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
- Cả hai file test đã được tích hợp vào lệnh chuẩn `npm test`.

Bản README cũ được giữ để đối chiếu tại [docs/README_V2_TRUOC_CHINH_SUA.md](docs/README_V2_TRUOC_CHINH_SUA.md); không dùng các tuyên bố cũ về xác minh ngân hàng, ngày công hay Internet Banking làm bằng chứng chức năng đã hoàn thành.
