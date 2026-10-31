# Đánh giá website quản lý lao động, tuyển dụng và thưởng

**Ngày đánh giá:** 19/10/2026  
**Phạm vi:** Rà soát tĩnh source code, schema/migrations, cấu hình và các test trong repository `Management-Office-Data-Tracking-Specialist`. Không sửa code, không ghi/xóa database, không chạy toàn bộ ứng dụng hoặc kiểm thử trên production.

## 1. Tóm tắt điều hành

Đây là ứng dụng nội bộ quản lý tương đối rộng: tuyển dụng và các đợt làm việc, hồ sơ lao động, import/export Excel, thưởng, tài khoản ngân hàng, chính sách thưởng, chi trả theo mốc, tra cứu trùng, dashboard/báo cáo, audit và quản trị người dùng/phân quyền. Nền tảng kỹ thuật gồm Next.js App Router, TypeScript, Prisma và SQLite; UI dùng Ant Design.

**Đánh giá tổng thể:** phạm vi chức năng khá đầy đủ và có nhiều nền tảng tốt như guard API, validation nghiệp vụ, transaction, audit log, optimistic concurrency và một số test hồi quy. Tuy nhiên, app **chưa nên được coi là sẵn sàng cho vận hành tài chính/nhân sự có dữ liệu thật ở quy mô lớn hoặc mở ra mạng rộng** trước khi xử lý các vấn đề P0. Điểm yếu chính không phải thiếu màn hình, mà là một số quy tắc quan trọng chưa đồng nhất giữa API, UI, import và database: fail-open ở xác thực, thao tác xóa nguy hiểm, thay đổi bản thưởng đã duyệt/khóa, nguy cơ trả thưởng đã được đánh dấu đã trả, commit import có thể báo thành công dù chỉ ghi một phần, lộ PII rộng, và quy trình migration/backup chưa đủ tin cậy.

Các finding dưới đây là **đánh giá code path từ source**, không khẳng định hệ thống production đang bị khai thác hay có dữ liệu thực tế sai. Mức ảnh hưởng runtime của một số điểm cần xác minh trên đúng cấu hình triển khai.

## 2. Hệ thống hiện có những gì?

| Mảng | Chức năng hiện thấy trong ứng dụng | Nhận xét ngắn |
|---|---|---|
| Đăng nhập và người dùng | Username/password, session cookie, role/grants, quản lý user, khóa/mở khóa, audit | Có nền tảng bảo mật tốt trong session/API, nhưng có các đường fallback ADMIN cần ưu tiên xử lý. |
| Hồ sơ lao động | Tạo/sửa hồ sơ, thông tin cá nhân, nhiều đợt tuyển dụng, trạng thái, lịch sử, archive/restore | Có nghiệp vụ khá sâu; hard-delete và lớp dữ liệu source cần siết lại. |
| Tuyển dụng | Đơn hàng, batch, nhà máy, recruiter/team, lookup, catalog trạng thái và import profile | Đã có liên kết và validation ở một số luồng; các luật liên kết chưa được áp dụng thống nhất trong import. |
| Excel Engine | Nhận file XLSX/Google Sheets, nhận diện DS_TONG/DS_THUONG/STK, preview/commit, mapping, smart merge, cảnh báo/trùng và export | Là module trọng yếu; còn vấn đề commit một phần, snapshot preview, provenance và dữ liệu nhạy cảm. |
| Quản lý thưởng | 7 khoản thưởng, tổng, tháng/công ty, nhân viên/đợt, trạng thái nháp/duyệt/khóa, chỉnh sửa và xóa | Chức năng rộng, nhưng cần bảo vệ chặt bất biến sổ thưởng và phân biệt dòng nguồn đã trả. |
| Ngân hàng/thanh toán | Quản lý STK, kiểm tra dữ liệu trước khi xuất PAYMENT_BATCH, tải file lệnh chi | Hiện chưa thấy nhà cung cấp xác minh tài khoản; cờ VERIFIED ở một số đường nhập chưa có bằng chứng. |
| Chính sách và thưởng theo mốc | Tạo policy, enrollment, snapshot điều kiện, stage 1–7, ghi nhận khoản trả thực tế | Có transaction/audit và kiểm tra điều kiện; cần tránh trộn nguồn Excel với payment canonical. |
| Báo cáo và vận hành | Overview, performance, duplicate review, audit, dashboard, lọc và xuất CSV/Excel | Có nhiều thống kê; một số định nghĩa trạng thái/KPI lệch nhau và truy vấn tải toàn bộ dữ liệu. |
| Hạ tầng dữ liệu | Prisma/SQLite, preview database, scripts, migration, backup khi clear | Có cơ chế preview và kiểm tra hash, nhưng cần thiết lập quy trình migration/restore có thể tái lập. |

## 3. Điểm mạnh đáng giữ

- **Session có kiểm tra thực chất:** mã nguồn kiểm tra HMAC timing-safe, hết hạn, phiên bản user, role và trạng thái active; cookie có `httpOnly`, `sameSite` và `secure` theo HTTPS.
- **Có lớp guard ở API:** nhiều API nghiệp vụ kiểm tra quyền và same-origin cho mutation; đây là lớp cần tiếp tục giữ kể cả khi UI được sửa.
- **Quy tắc dữ liệu tương đối phong phú:** có kiểm tra CCCD, số điện thoại, ngày, tháng, số tiền, trạng thái và một số quan hệ tuyển dụng.
- **Có transaction, audit và optimistic concurrency:** xuất hiện trong nhiều luồng tạo/sửa/duyệt, giúp giảm ghi dở dang và ghi đè dữ liệu mới.
- **Import có preview/commit:** ý tưởng cho người dùng xem kết quả trước khi ghi là tốt; parser lưu ý dữ liệu nguồn và cảnh báo thay vì tự đoán mọi thứ.
- **Payment có xu hướng fail-closed:** helper an toàn thanh toán không mặc nhiên tin một số cờ legacy và có thể chặn xuất khi thiếu điều kiện.
- **Có test nghiệp vụ:** đã có test cho payment safety, business rules, một số luồng import/source/reporting và integration; cần đưa coverage quan trọng vào lệnh CI mặc định.

## 4. Rủi ro và vấn đề theo module

### 4.1 Đăng nhập, người dùng và phân quyền — ưu tiên P0

**Hiện có:** đăng nhập username/password, session HMAC, quyền ADMIN/HR/FINANCE/VIEWER, quản trị người dùng và guard API.

**Phát hiện:**

1. `src/lib/auth.ts:79-117` có đường trả identity ADMIN cho host bắt đầu bằng `localhost`/`127.0.0.1` khi điều kiện biến môi trường thỏa mãn; cùng đoạn này cũng có thể fallback local identity nếu token/config không hợp lệ. Đây là code path cần đóng ở môi trường không phải dev.
2. Kiểm tra `Host` bằng `startsWith` có thể chấp nhận hostname có tiền tố như `localhost.evil.example`. Khả năng request đó đến được app phụ thuộc reverse proxy, binding và cấu hình runtime.
3. `src/components/AuthGate.tsx:34-45` dùng user mặc định ADMIN khi API `/api/auth/me` lỗi, 401 hoặc mất kết nối. Điều đó làm UI hiển thị quyền sai; chưa chứng minh backend guard bị vượt qua.
4. Trong source đã khảo sát chưa thấy trang/caller đăng nhập gọi `POST /api/auth/login`. Cần xác nhận luồng login không nằm ngoài repository.
5. Rate limit login dùng bộ nhớ trong process, không dùng kho chung giữa nhiều instance.

**Nên làm:** tắt auto-admin theo mặc định ngoài local opt-in; parse và so sánh hostname chính xác; AuthGate phải fail-closed với trạng thái chưa đăng nhập/lỗi; xác nhận có UI đăng nhập; chuyển rate limit sang shared store/ingress nếu scale.

### 4.2 Excel Engine, import/export và review — ưu tiên P0/P1

**Hiện có:** đọc XLSX/Google Sheets, tự nhận diện DS_TONG/DS_THUONG/STK, preview/commit, mapping, smart merge, duplicate/warning review và một số export.

**Phát hiện:**

1. `src/app/api/excel-engine/import/route.ts` có thể tăng `errorCount` khi lỗi từng dòng/commit nhưng vẫn trả `success:true`; UI `src/app/excel-tools/page.tsx` dựa vào `success` để hiện toast thành công. Do đó có thể báo thành công dù chỉ ghi một phần hoặc không ghi được một số dòng.
2. Endpoint clear có đường xóa worker không còn assignment và tài khoản ngân hàng theo nội dung check, không chứng minh tất cả đối tượng đó được tạo bởi Excel. Tên/nội dung UI mô tả phạm vi “dữ liệu đã import” hẹp hơn hành vi xóa trong code.
3. Với Google Sheets, preview và commit gửi URL và server đọc lại ở mỗi request; nội dung sheet có thể đổi sau khi preview.
4. Review lưu/trả raw values theo dòng; chưa thấy allowlist/redaction/retention đủ rõ cho CCCD, STK và dữ liệu nhạy cảm.
5. Không thấy cơ chế idempotency/import run xuyên suốt. Một số đường dựa vào dò trùng ở ứng dụng; database chưa đảm bảo tất cả khóa nghiệp vụ bằng unique constraint.
6. Export hồ sơ lao động chỉ lấy assignment đầu tiên theo code hiện được rà soát, có thể không bảo toàn lịch sử nhiều đợt nếu dùng làm vòng xuất–nhập.

**Nên làm:** trả trạng thái `complete/partial/failed` cùng số dòng attempted/succeeded/failed và chi tiết dòng; không toast xanh khi có lỗi; lưu snapshot/hash cho preview rồi commit đúng snapshot; thêm `importRunId`/idempotency key và ràng buộc DB phù hợp; giới hạn clear theo provenance/source ID; mask và đặt retention cho raw source.

### 4.3 Hồ sơ lao động và các đợt tuyển — ưu tiên P0/P1

**Hiện có:** tìm kiếm/lọc, tạo/sửa hồ sơ, thêm đợt, trạng thái, lịch sử, archive/restore, source rows và liên kết với các module khác.

**Phát hiện:**

1. Xóa từ danh sách có thể hard-delete assignment, event, bonus và cả worker; không phải mọi đường đều chặn assignment đang hoạt động. Đây là rủi ro mất lịch sử và khó khôi phục.
2. API nhận worker ID và assignment ID riêng nhưng cần bảo đảm assignment thực sự thuộc worker đó trước khi xóa.
3. Dòng dữ liệu nguồn chưa liên kết dùng ID nguồn kiểu `source-*`; các handler sửa/xóa có thể gửi ID đó qua API hồ sơ chuẩn, trong khi API hồ sơ không xử lý như source row. Có thể dẫn đến lỗi không sửa được, xóa nhầm hồ sơ đã liên kết, hoặc dòng nguồn xuất hiện lại.
4. `worker-source-rows`/`worker-history` trả dữ liệu tài khoản đầy đủ trong một số response; cần đánh giá lại quyền read và nhu cầu từng màn hình.
5. Snapshot nguồn có thể cũ hơn DB sau khi sửa; cách ưu tiên giá trị nguồn ở UI có nguy cơ hiển thị dữ liệu cũ hoặc tạo dòng trùng sau chuẩn hóa.
6. Lọc theo khoảng ngày có đường bỏ qua dòng thiếu ngày; reset filter có thể chưa kích hoạt fetch lại tùy dependency state.

**Nên làm:** ưu tiên archive/soft-delete; hard-delete chỉ qua luồng đặc quyền có xác nhận và audit; kiểm tra ownership mọi ID ở server; tách CRUD source row khỏi CRUD worker; để dữ liệu chuẩn hiện hành làm nguồn hiển thị chính và source chỉ làm đối chiếu; mask STK/CCCD.

### 4.4 Quản lý thưởng — ưu tiên P0

**Hiện có:** 7 lần thưởng, import DS_THUONG, form thêm/sửa, lọc, duyệt/khóa, audit, xóa từng/toàn bộ và xuất payment.

**Phát hiện:**

1. Nhánh smart merge DS_THUONG có thể cập nhật khoản tiền/metadata của record `APPROVED` hoặc `LOCKED` mà không kiểm tra trạng thái và không xử lý lại thông tin duyệt. Điều này phá tính bất biến của sổ thưởng.
2. Dòng được đánh dấu nguồn `SOURCE_EXCEL_ACTUAL_PAID` vẫn được tạo ở trạng thái `DRAFT`; giao diện có thể cho duyệt, còn luồng export không thấy loại trừ chắc chắn mọi bản ghi nguồn này. Cần chặn bằng API, không chỉ nhãn giao diện, để tránh chi lại.
3. DELETE bonus chỉ cần quyền ghi và có nhánh xóa toàn bộ; chưa bảo vệ bản đã duyệt/khóa. Audit log không thay thế được dữ liệu đã xóa.
4. Một số đường tạo bank account gắn trạng thái `VERIFIED` chỉ vì người dùng/import cung cấp STK, trong khi luồng payment safety nói chưa có provider/bằng chứng xác minh.
5. Parser chấp nhận tổng thưởng khai báo khác tổng 7 khoản; có thể chỉ phát hiện mismatch lúc duyệt thay vì preview/import.
6. GET tải nhiều record và dữ liệu tài khoản; lọc CCCD/mã NV ở UI làm tăng lượng dữ liệu trả về và bề mặt lộ thông tin.

**Nên làm:** khóa update/delete/merge trên `APPROVED`/`LOCKED`; nếu cần sửa phải có quy trình đặc quyền, lý do, old/new và audit; tách dữ liệu đã trả khỏi dữ liệu payable và cấm approve/export; chỉ gắn VERIFIED khi có chứng cứ; báo mismatch tổng ngay ở preview; thêm pagination và lọc server-side.

### 4.5 Ngân hàng và thanh toán — ưu tiên P0/P1

**Hiện có:** CRUD STK, endpoint verify và export PAYMENT_BATCH có nhiều kiểm tra an toàn.

**Phát hiện:**

1. Endpoint xác minh hiện trả 503/chưa có provider; payment safety chặn khi thiếu evidence. Kết quả là luồng xuất chi có thể bị chặn toàn bộ nếu chưa có một workflow xác minh thay thế.
2. Đường import/form có nơi tự gắn `VERIFIED`/`isNameVerified` chỉ từ dữ liệu nhập; đây là ý nghĩa trạng thái không nhất quán.
3. API bank account trả nguyên STK/CCCD cho mọi role có quyền đọc theo grants hiện thấy; payment export có thể chứa PII thừa và thiếu header `Cache-Control: no-store`.
4. Chưa thấy unique constraint ngăn tài khoản trùng theo worker; nhiều tài khoản có thể làm hệ thống không xác định được đích chi.

**Nên làm:** xác minh bằng provider hoặc quy trình thủ công hai người có actor/timestamp/chứng từ; nếu chưa xác minh thì lưu `PENDING/UNVERIFIED`; tách quyền xem dữ liệu ngân hàng; mask/loại PII không cần thiết; `no-store` cho file; thêm unique và validation theo ngân hàng.

### 4.6 Chính sách thưởng, enrollment và reward payments — ưu tiên P1/P2

**Hiện có:** policy có khoảng hiệu lực, snapshot rules, enrollment theo assignment, reward stages, xác nhận đạt mốc và ghi nhận trả thực tế có reference.

**Phát hiện:**

1. API enrollment dựng các payment tổng hợp từ BonusRecord Excel với reference/ngày fallback rồi cộng vào paid total; đây không phải `RewardPayment` canonical có chứng từ/audit tương ứng.
2. API policy chưa thấy chặn khoảng hiệu lực active chồng nhau hoặc nhiều policy cùng áp dụng cho assignment; chỉ lọc trên UI không đủ bảo vệ.
3. Tạo policy kiểm tra order tồn tại/nhà máy nhưng chưa thấy kiểm tra `order.isActive`.
4. Payment cap có đường đọc tổng đã trả rồi tạo payment; cần thử concurrent requests trên staging để chứng minh invariant không thể vượt.
5. Prisma schema và migration có khác biệt ON DELETE CASCADE/RESTRICT theo rà soát.

**Nên làm:** tách rõ khoản đã trả theo Excel với payment canonical; không dùng ngày fallback làm ngày chi; kiểm tra overlap/inactive order ở server; đảm bảo payment cap bằng transaction/conditional update hoặc khóa; đồng bộ migration/schema.

### 4.7 Đơn hàng, batch, recruiter/team và lookup — ưu tiên P0/P1

**Hiện có:** quản lý order/batch, factory, recruiter/team, catalogs, mapping và tra cứu theo mã.

**Phát hiện:**

1. `/api/lookup` trong source được rà soát chưa gọi guard/identity và có trả CCCD đầy đủ, lịch sử công ty/thưởng. Cần kiểm tra public exposure/proxy, nhưng API nên có xác thực hoặc yếu tố xác minh.
2. Một nhánh import tạo assignment mà không gọi helper kiểm tra quan hệ đầy đủ; order, batch, factory, recruiter/team có thể không khớp.
3. Có thể tạo batch trong order inactive ở API; định dạng kỳ tuyển có chỗ dùng `YYYY-MM`, chỗ dùng `TMM.YYYY`.
4. Recruiter và team có thể được chọn độc lập; cần bảo đảm server không lưu team khác recruiter.
5. Import mapping/smart merge chưa hỗ trợ đủ một số ID liên kết; status lạ có thể bị tự tạo thành catalog active.
6. Lookup dùng `findFirst` trên mã chưa unique nên mã trùng có thể trả hồ sơ không mong muốn.

**Nên làm:** bảo vệ lookup và tối thiểu hóa response; gọi chung domain relation validator ở mọi đường nhập; chuẩn hóa period; enforce recruiter-team; đưa status lạ vào review/quarantine; xử lý mã trùng bằng kết quả ambiguous thay vì chọn đầu tiên.

### 4.8 Dashboard, báo cáo, duplicate và audit — ưu tiên P1/P2

**Hiện có:** KPI overview/performance, lọc theo thời gian/công ty/team/recruiter, drill-down, CSV, duplicate scan và audit.

**Phát hiện:**

1. Duplicate detector có thể báo “SĐT hoạt động khác xưởng” dù cùng xưởng hoặc hồ sơ còn lại không có assignment active; trạng thái active được hard-code thay vì lấy từ catalog/domain rule.
2. Tái tuyển dụng có thể bị suy ra chỉ từ việc có nhiều assignment, không kiểm tra assignment trước đã kết thúc hợp lệ.
3. Outstanding âm/overpaid có thể bị UI ép về 0 hoặc pay rate tối đa 100%, làm mất tín hiệu cần đối soát.
4. Reports tải toàn bộ worker/enrollment/bonus/source rồi aggregate trong memory; đây là rủi ro mở rộng, chưa có số đo runtime.
5. Một số page giữ dữ liệu cũ sau lần refresh lỗi; audit merge hai nguồn có cách lọc/phân trang khác nhau.

**Nên làm:** thống nhất predicate active/rehire với business rules; hiển thị rõ overpaid/reconciliation; lọc/select/paginate ở DB và đo p95/memory; có banner stale/error; hợp nhất audit stream rồi mới paginate.

### 4.9 Kiến trúc UI, API, validation và accessibility — ưu tiên P1/P2

**Phát hiện:**

- Một số loader đọc `r.json()` mà không kiểm tra `response.ok`, hoặc catch rỗng; lỗi reference data có thể hiện thành dropdown rỗng.
- Không thấy app-level `error.tsx`/`loading.tsx`/`global-error.tsx` trong phạm vi được rà soát.
- API trả lỗi tổng quát nhưng không thấy structured logger/correlation ID thống nhất ở application layer.
- Header có trạng thái kết nối hard-code, không dựa health check.
- `strict: false` và dùng `any` rộng làm giảm khả năng phát hiện lệch request/response khi refactor.
- Một số icon button thiếu accessible name/keyboard/focus semantics nhất quán.
- `npm test` mặc định không chạy tất cả test file hiện có; một số test import/review/integration phải gọi riêng.

**Nên làm:** có API client chuẩn kiểm tra HTTP/envelope, loading/error/retry; thêm error boundaries; structured logging không chứa PII; health status thật; schema request/response dùng chung; tăng strictness theo lộ trình; bổ sung keyboard/axe tests và đưa test suite vào CI.

### 4.10 Database, migration, backup và vận hành — ưu tiên P0

**Phát hiện:**

1. Quy trình chính thấy trong package chủ yếu là `db:push`; chưa có quy trình `migrate deploy` và migration history đáng tin cậy cho DB đã rà soát.
2. Có migration directory được phát hiện thiếu `migration.sql`; chain migration vì vậy cần kiểm tra lại trên trạng thái repo/commit bất biến.
3. Runtime phụ thuộc biến LOCAL/preview config; fresh checkout không có `.local` có thể thiếu URL DB; README cần hướng dẫn rõ bước chuẩn bị lần đầu.
4. Schema/migration/DB có drift ở snapshot STK/ngân hàng của BonusRecord theo source đã rà soát. Cần thống nhất ba nguồn trước khi phát hành.
5. Backup trước clear chỉ copy file SQLite chính; nếu WAL/SHM đang hoạt động, copy đơn lẻ có thể không phải snapshot nhất quán. Chưa thấy restore drill.
6. Có script đồng bộ hard-code đường dẫn DB và ghi dữ liệu; `db:seed` có `deleteMany` toàn bảng, chưa thấy guard phá hủy đủ mạnh.
7. Tiền dùng `Float`, ngày/tháng dùng `String`; thiếu một số unique/index nghiệp vụ nên integrity phụ thuộc code.

**Nên làm:** đóng băng thao tác triển khai destructive tới khi có backup/restore kiểm thử; hoàn thiện migration chain/baseline; chuẩn hóa DB URL và hướng dẫn fresh install; đồng bộ schema/migration/database; dùng snapshot SQLite an toàn, checksum/retention/integrity check; guard seed/sync bằng target allowlist, dry-run và confirmation; cân nhắc integer minor units/Decimal và unique constraints.

## 5. Backlog cải tiến theo thứ tự

### P0 — xử lý trước khi mở rộng vận hành/dữ liệu thật

1. **Đóng fail-open authentication:** bỏ local auto-admin mặc định ngoài local opt-in; kiểm tra host chính xác; AuthGate không fallback ADMIN; xác nhận luồng đăng nhập hoạt động.
2. **Ngăn xóa không thể khôi phục:** clear/delete cần provenance, ownership, archive mặc định, backup và restore đã thử; bảo vệ assignment đang hoạt động và bản thưởng đã duyệt/khóa.
3. **Bảo vệ bất biến tài chính:** không merge/sửa/xóa APPROVED/LOCKED; dòng đã trả từ Excel không được approve/export lại; không gắn VERIFIED nếu chưa có evidence.
4. **Thiết lập migration và restore:** hoàn thiện migration chain, baseline phù hợp DB hiện tại, backup SQLite nhất quán và diễn tập restore trên bản sao trước mọi thay đổi lớn.

### P1 — cần làm sớm

5. **Làm rõ kết quả import:** có complete/partial/failed và số dòng cụ thể; commit đúng snapshot đã preview; retry an toàn với import ID/idempotency.
6. **Giảm lộ dữ liệu:** bảo vệ lookup; mask CCCD/STK; quyền riêng cho dữ liệu tài chính; hạn chế raw import review và retention; đặt `no-store` cho export nhạy cảm.
7. **Thống nhất domain invariants:** quan hệ order/batch/factory/recruiter/team; policy active/overlap; status semantics; duplicate/rehire predicate.
8. **Hoàn thiện payment workflow:** có bằng chứng xác minh thực tế hoặc quy trình thủ công hai người; payment cap an toàn khi request đồng thời.
9. **Chuẩn hóa error handling/observability:** response errors, retry state, error boundary, structured logs và correlation ID.

### P2 — độ bền và khả năng mở rộng

10. Đưa lọc/pagination/report aggregation xuống database; đo hiệu năng với bộ dữ liệu lớn.
11. Sửa KPI overpaid và hợp nhất định nghĩa báo cáo/audit.
12. Đồng bộ schema/migration, chuẩn hóa tiền/ngày/tháng, thêm unique/index/ràng buộc.
13. Cải thiện accessibility, health state, stale request/cancellation và UI theo grants.

### P3 — làm sạch và nâng chất lượng dài hạn

14. Đưa đầy đủ test unit/API/integration vào CI; bổ sung các ca auth, partial import, concurrency, delete ownership, paid export, masking, restore/migration và accessibility.
15. Dọn dashboard API/contract trùng, script hard-code DB, seed phá hủy; tăng TypeScript strictness theo từng module.

## 6. Cách kiểm tra trước khi sửa các rủi ro lớn

- Dùng **database clone/staging**, không thử các thao tác clear/delete/seed trên DB đang có dữ liệu thật.
- Với authentication: kiểm tra request không cookie trên localhost, hostname giả có prefix, môi trường preview/proxy và `LOCAL_DEMO_AUTO_VIEW` tắt; xác nhận API trả 401/403.
- Với import: tạo workbook có dòng hợp lệ/lỗi/trùng, thử preview → commit, commit thất bại một phần và retry; xác nhận số bản ghi thực trong DB khớp response.
- Với thưởng: thử sửa/xóa/merge trên DRAFT, APPROVED, LOCKED và record đã trả; xác nhận API từ chối đường không hợp lệ và export không đưa dòng đã trả vào batch.
- Với backup: tạo snapshot trong lúc SQLite dùng WAL, mở bản sao bằng `PRAGMA integrity_check`, khôi phục sang thư mục khác và chạy smoke test.
- Với quyền/PII: gọi trực tiếp API bằng từng role, không chỉ kiểm tra nút ẩn trên UI; xác nhận response chỉ chứa trường thực sự cần.

## 7. Giới hạn đánh giá

- Đây là audit tĩnh trên source, schema, migration, test và cấu hình trong repository; không phải pentest, review production hoặc chứng nhận tuân thủ.
- Không khởi chạy browser/app, không gửi request runtime, không thực hiện thay đổi database và không xác minh reverse proxy, binding, secrets, quyền thực tế hoặc production data.
- Những nhận xét về race, tải dữ liệu lớn, exposure qua mạng và cache cần kiểm chứng trên staging với cấu hình giống môi trường chạy.
- Các test được nhắc là test file/coverage đọc thấy; không suy ra toàn bộ test suite pass.
- Dẫn chứng đường dẫn/dòng tham chiếu là theo source được đọc trong lượt đánh giá; nên tạo issue gắn với commit cụ thể trước khi bắt đầu sửa.

## Kết luận

Ứng dụng đã có nhiều module nghiệp vụ và một số lớp kỹ thuật vững, nhưng rủi ro hiện tập trung ở **tính toàn vẹn dữ liệu, an toàn tài chính, fail-closed authorization, dữ liệu cá nhân và vận hành database**. Trình tự phù hợp là: **P0 xác thực + xóa + bất biến thưởng/thanh toán + backup/migration; tiếp đến P1 import/idempotency + PII + domain rules; rồi mới tối ưu báo cáo, UI và refactor dài hạn.**