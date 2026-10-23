# Phục hồi import và đối chiếu lượt tuyển

## Luồng sử dụng

1. Quét file Excel hoặc Google Sheets. Kết quả có mã phiên và dấu kiểm tra dữ liệu ô.
2. Xác nhận ghi từ chính kết quả quét đó. Giao diện giữ nguyên mã phiên và các tùy chọn đã quét khi thử lại.
3. Nếu mất phản hồi, thử xác nhận lại cùng phiên. Biên nhận đã commit sẽ trả kết quả cũ và không ghi lặp.
4. Trong trang Excel Tools, mục **Phiên import cần xử lý** phân biệt:
   - **Đang xử lý**: chờ tác vụ hiện tại; không chạy phiên khác cho cùng nguồn.
   - **Chưa ghi**: toàn bộ phần ghi database của phiên đã rollback; tải lại nguồn và quét hoặc thử lại cùng phiên.
   - **Đã ghi, còn thiếu snapshot nguồn**: bấm **Phục hồi**; không cần workbook gốc và không chạy lại các lệnh ghi nghiệp vụ.
   - **Cần kiểm tra nhật ký**: không tự sửa/xóa journal; kiểm tra biên nhận và bản sao lưu.

Các lô của một phiên cùng nằm trong một transaction SQLite. Tải workbook và tính fingerprint diễn ra trước transaction. Khi ghi file lớn, SQLite có thể phải chờ thao tác ghi hiện tại; timeout toàn transaction là 600 giây.

Snapshot được lưu tạm và đồng bộ xuống đĩa trước khi biên nhận commit được ghi cùng dữ liệu nghiệp vụ. Chỉ công bố snapshot sau commit. Nhật ký có checksum và khóa theo mã phiên; dấu hoàn tất giúp giữ nguyên các sửa/xóa nguồn mà người dùng thực hiện sau import.

## Đối chiếu liên kết

Mở **Đối chiếu nguồn với lượt tuyển**, bấm **Đối chiếu / Tải lại**. Bộ lọc phân biệt thiếu hồ sơ, thiếu lượt tuyển, thiếu ngày/công ty, sai danh tính, khác mã/công ty, nhiều lượt cùng ngày và xung đột nguồn.

Chỉ khớp khi CCCD, họ tên đã có, ngày PV, công ty và mã nhân viên đã có không mâu thuẫn. Không chọn theo SĐT hoặc tự lấy lượt tuyển gần nhất. Khi chưa có lượt tuyển, nhập DS_TONG hoặc bổ sung lượt tuyển đã xác minh trước; DS_THUONG không đủ căn cứ tự dựng lịch sử tuyển dụng.

**Liên kết thưởng** chỉ gắn bản thưởng nguồn hiện có với lượt tuyển khớp duy nhất, không đổi số tiền, không tạo hồ sơ/lượt tuyển, không ghi đè bản đã duyệt/khóa. Server kiểm tra lại token, số tiền, dữ liệu nguồn và phiên bản bản thưởng, rồi lưu audit trong cùng transaction.

## Vận hành và kiểm thử

- Không cần đổi schema hoặc chạy migration trên database nghiệp vụ.
- Sao lưu đồng bộ database, thư mục .local/source-imports và .local/import-recovery. Biên nhận database không thay thế nội dung snapshot trên đĩa.
- Cơ chế phục hồi áp dụng cho phiên mới có nhật ký. Không suy đoán ranh giới của lần import dở từ phiên bản cũ; các trường hợp cũ phải đối chiếu riêng.
- npm test: test cô lập, bao gồm rollback/retry/checksum/token/liên kết.
- npm run test:import-recovery: dùng Prisma và SQLite thật trong thư mục tạm riêng; tạo schema chỉ trong database fixture, kiểm tra rollback sau lô hồ sơ, retry, công bố snapshot và liên kết thưởng. Không dùng database nghiệp vụ.
