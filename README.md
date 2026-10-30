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

Bản README cũ được giữ để đối chiếu tại [docs/README_V2_TRUOC_CHINH_SUA.md](docs/README_V2_TRUOC_CHINH_SUA.md); không dùng các tuyên bố cũ về xác minh ngân hàng, ngày công hay Internet Banking làm bằng chứng chức năng đã hoàn thành.
