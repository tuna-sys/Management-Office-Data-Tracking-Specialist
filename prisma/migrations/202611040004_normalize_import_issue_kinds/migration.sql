-- Normalize historical backfill rows so DataIssue.kind matches the runtime classifier.
UPDATE "DataIssue"
SET "kind" = CASE
  WHEN "message" LIKE '%Danh sách đen%' OR "message" LIKE '%DS Đen%' THEN 'BLACKLIST'
  WHEN "message" LIKE '%Trùng SĐT%' THEN 'PHONE'
  WHEN "message" LIKE '%CHƯA BÁO NGHỈ%' OR "message" LIKE '%CẦN QUẢN LÝ XÁC NHẬN%' OR "message" LIKE '%nhảy sang%' THEN 'CROSS_COMPANY'
  WHEN "message" LIKE '%STK trùng%' OR "message" LIKE '%tài khoản%' THEN 'BANK_ACCOUNT'
  WHEN "message" LIKE '%Sai lệch danh tính%' THEN 'IDENTITY_MISMATCH'
  WHEN "message" LIKE '%thưởng%' THEN 'BONUS'
  WHEN "message" LIKE '%Trùng lặp nội bộ%' OR "message" LIKE '%Trùng ngày PV tại hai công ty%' OR "message" LIKE '%Khác mã theo công ty%' OR "message" LIKE '%Lượt PV đã được người khác thêm%' OR "message" LIKE '%Bản thưởng của đợt đã có%' THEN 'INTERNAL_DUPLICATE'
  WHEN "message" LIKE '%SĐT%' THEN 'PHONE_NOTICE'
  ELSE 'DATA_WARNING'
END
WHERE "kind" IN ('WARNING', 'DUPLICATE');
