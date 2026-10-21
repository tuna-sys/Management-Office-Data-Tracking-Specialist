# ERD — hệ thống quản lý lao động

## Tệp sơ đồ

- `ERD_hien_trang.mmd`: phản ánh model và khóa ngoại trong `prisma/schema.prisma` hiện có.
- `ERD_de_xuat.mmd`: thiết kế mục tiêu đề xuất; các khóa `interviewFactoryId`, `workingFactoryId`, `statusId` và khóa ghép đợt tuyển là phần cần bổ sung, chưa tồn tại trong schema hiện tại.

## Đọc sơ đồ hiện trạng

- `PK`: khóa chính; `FK`: khóa ngoại; `UK`: duy nhất.
- Các chuỗi `interviewFactory`, `workingFactory`, `status`, `recruiter`, `team`, `employeeCode` và một số tên/kỳ snapshot hiện là text, không phải quan hệ FK.
- `RecruitmentBatch` thuộc đúng một `RecruitmentOrder`; mỗi `WorkAssignment` có thể chưa gán order/batch.
- `Recruiter` có thể thuộc một `RecruitmentTeam`; assignment lưu riêng `recruiterId` và `teamId` cùng các tên text.
- `BonusRecord` gắn bắt buộc với Worker, có thể gắn với Assignment; tài khoản/ngân hàng trên bản thưởng là snapshot.
- `ImportProfile` là bảng cấu hình. Dữ liệu hàng import/review của ứng dụng còn có phần lưu file JSON, nên không biểu diễn như bảng quan hệ Prisma.

## Khuyến nghị chính trong ERD đề xuất

1. Dùng Factory trong DB cho cả nhà máy phỏng vấn và nhà máy làm việc, thay các tên nhà máy nhập tự do; giữ snapshot tên nếu cần bảo toàn lịch sử khi danh mục đổi tên.
2. Chuẩn hóa trạng thái assignment bằng `statusId` tham chiếu `LaborStatus`, trong khi lịch sử sự kiện vẫn giữ snapshot tên trạng thái.
3. Giữ `Recruiter.teamId` là team hiện tại của chuyên viên; `WorkAssignment.teamId` là team phụ trách tại thời điểm của đợt. Backend phải kiểm tra lựa chọn hợp lệ và đồng bộ snapshot tên.
4. Bảo đảm `batchId` thuộc cùng `orderId` ở mọi đường ghi (form, import, duyệt import). Khóa ngoại đơn lẻ không đủ diễn đạt quy tắc này.
5. `employeeCode` là mã nhân viên theo công ty/đợt, không nên coi là danh mục toàn cục; chỉ thêm unique constraint nếu nghiệp vụ xác nhận phạm vi duy nhất (ví dụ company + employeeCode).
6. Trước khi thêm quan hệ mới, cần đối soát và backfill chuỗi nhà máy/trạng thái hiện có; không xóa snapshot lịch sử trong cùng migration.
