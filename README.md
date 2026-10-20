# L-Incentive — quản lý lao động và thưởng cục bộ

Đặc tả cập nhật ngày 12/10/2026: [Đọc bản đặc tả đầy đủ](docs/DAC_TA_HE_THONG_CAP_NHAT_2026-10-12.md).

Đã bổ sung đăng nhập/phân quyền, quản lý tài khoản, hồ sơ và lịch sử tái tuyển, kiểm tra nghỉ việc, chính sách 7 mốc, sửa dự thảo/duyệt/khóa thưởng, nhật ký và nhập Excel qua bước xem trước.

**Xác minh ngân hàng chưa kết nối. Mọi lệnh chi được chặn cho đến khi có bằng chứng thật. Duyệt/khóa thưởng không có nghĩa là đã chuyển tiền.**

## Chạy cục bộ

Sao chép `.env.example` thành `.env` nếu chưa có, rồi kiểm tra `DATABASE_URL`. App chỉ kết nối URL được cấu hình; nó không tự chọn database preview, tạo schema hoặc chạy migration khi khởi động.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run auth:setup
npm run dev
```

Tạo ADMIN đầu tiên bằng thông tin tự đặt; không có mật khẩu mặc định. Mở http://127.0.0.1:3000. Quản trị viên quản lý thêm tài khoản tại Phân quyền. Cấu hình đăng nhập được lưu riêng trong `.local/auth.json`, không nằm trong CSDL lao động và không đưa lên Git.

```powershell
npm test
npm run test:integration
npm run build
npm start
```

`DATABASE_URL` trong `.env` trỏ tới DB SQLite duy nhất của môi trường đang chạy. Mặc định local là `file:./dev.db`, tương ứng `prisma/dev.db`. Không đặt URL sang file preview hoặc dùng cùng một file SQLite đồng thời ở nhiều môi trường.

Kiểm tra migration bằng `npm run db:migrate:status`; tạo migration trong môi trường phát triển bằng `npm run db:migrate:dev`; triển khai migration đã được review bằng `npm run db:migrate:deploy`. Migration hiện có trong repository cần được đối chiếu/baseline trước khi chạy trên DB đã có dữ liệu; một thư mục migration đang thiếu `migration.sql`. Không chạy `db:push` hoặc `migrate deploy` trên DB thật cho tới khi baseline và backup/restore được xác minh.

Kiểm thử integration dùng CSDL/tài khoản giả lập riêng trong `.local/qa-*` qua `DATABASE_URL` và cổng loopback 3101. Không nhập thử vào DB thật. Các lệnh chạy ứng dụng chỉ bind localhost.

Các thay đổi code không tự chạy migration hay thay đổi database hiện có.

Bản README cũ được giữ để đối chiếu tại [docs/README_V2_TRUOC_CHINH_SUA.md](docs/README_V2_TRUOC_CHINH_SUA.md); không dùng các tuyên bố cũ về xác minh ngân hàng, ngày công hay Internet Banking làm bằng chứng chức năng đã hoàn thành.
