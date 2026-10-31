/**
 * src/lib/status-mapping.ts
 * Quản lý chuẩn hóa trạng thái nguồn (Canonical Status Mapping).
 * 
 * Nguyên tắc:
 * 1. Giữ nguyên chuỗi gốc trong snapshot nguồn (phục vụ đối soát, kiểm toán).
 * 2. Ánh xạ về trạng thái chuẩn hóa trong CSDL để tránh phân mảnh báo cáo.
 * 3. Gán đúng các cờ nghiệp vụ:
 *    - category: Nhóm trạng thái (STOP, NEW, TRAINING, SOURCE, WORKING...)
 *    - endsAssignment: true nếu đợt tuyển kết thúc (bỏ, trượt, chuyển xưởng, hết phí...)
 *    - warnsDuplicate: true nếu cần cảnh báo nghiêm ngặt khi có hồ sơ mới (ví dụ DS Đen)
 */

export interface CanonicalStatusDefinition {
  canonicalName: string;
  category: string;
  endsAssignment: boolean;
  warnsDuplicate: boolean;
  description: string;
}

export const CANONICAL_STATUS_REGISTRY: Record<string, CanonicalStatusDefinition> = {
  // 1. Các trạng thái dừng / kết thúc đợt tuyển (STOP)
  "bỏ ksk": {
    canonicalName: "Bỏ khám sức khỏe",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Ứng viên không đến khám hoặc bỏ cuộc khi khám sức khỏe",
  },
  "bỏ khám sức khỏe": {
    canonicalName: "Bỏ khám sức khỏe",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Ứng viên không đến khám hoặc bỏ cuộc khi khám sức khỏe",
  },
  "ds đen": {
    canonicalName: "Danh sách đen",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: true,
    description: "Danh sách đen/vi phạm kỷ luật, kết thúc đợt và cảnh báo nghiêm ngặt khi nhập hồ sơ mới",
  },
  "danh sách đen": {
    canonicalName: "Danh sách đen",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: true,
    description: "Danh sách đen/vi phạm kỷ luật, kết thúc đợt và cảnh báo nghiêm ngặt khi nhập hồ sơ mới",
  },
  "chuyển fih": {
    canonicalName: "Chuyển xưởng",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Chuyển sang nhà máy FIH, kết thúc đợt tuyển tại nhà máy hiện tại",
  },
  "chuyển xưởng": {
    canonicalName: "Chuyển xưởng",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Chuyển sang nhà máy khác, kết thúc đợt tuyển tại nhà máy hiện tại",
  },
  "bỏ xx": {
    canonicalName: "Bỏ XX",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Bỏ xưởng xuất sắc/bỏ sau tuyển",
  },
  "bỏ đt": {
    canonicalName: "Bỏ ĐT",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Bỏ đào tạo",
  },
  "trượt ksk": {
    canonicalName: "Trượt KSK",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Trượt khám sức khỏe",
  },
  "ko theo dõi": {
    canonicalName: "Ko theo dõi",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Không còn theo dõi tiến độ",
  },
  "tự ý nghỉ việc": {
    canonicalName: "Tự ý nghỉ việc",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Tự ý bỏ việc/nghỉ không phép",
  },
  "nh": {
    canonicalName: "NH",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Nghỉ hẳn",
  },
  "hhđ": {
    canonicalName: "HHĐ",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Hết hợp đồng",
  },
  "hết phí": {
    canonicalName: "Hết phí",
    category: "STOP",
    endsAssignment: true,
    warnsDuplicate: false,
    description: "Hết thời gian hưởng phí tuyển dụng",
  },

  // 2. Các trạng thái mới tiếp nhận / đang trong quy trình (NEW)
  "chưa đt": {
    canonicalName: "Chưa đào tạo",
    category: "NEW",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Ứng viên trúng tuyển nhưng chưa tham gia đào tạo",
  },
  "chưa đào tạo": {
    canonicalName: "Chưa đào tạo",
    category: "NEW",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Ứng viên trúng tuyển nhưng chưa tham gia đào tạo",
  },
  "đang chờ phỏng vấn": {
    canonicalName: "Đang chờ phỏng vấn",
    category: "NEW",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Đang chờ phỏng vấn",
  },

  // 3. Các trạng thái đang đào tạo / nguồn đặc thù
  "đỗ - ko tính": {
    canonicalName: "Đỗ - Ko tính",
    category: "SOURCE",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Trúng tuyển nhưng không tính chỉ tiêu thưởng",
  },
  "gtnb": {
    canonicalName: "GTNB",
    category: "SOURCE",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Giới thiệu nội bộ",
  },
  "lv": {
    canonicalName: "LV",
    category: "SOURCE",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Lên việc / Đi làm",
  },
};

/**
 * Chuẩn hóa tên trạng thái từ chuỗi thô của file Excel sang định nghĩa chuẩn.
 */
export function resolveCanonicalStatus(rawStatus: string): CanonicalStatusDefinition {
  const clean = String(rawStatus || "").trim().toLowerCase();
  if (!clean) {
    return {
      canonicalName: "Đang chờ phỏng vấn",
      category: "NEW",
      endsAssignment: false,
      warnsDuplicate: false,
      description: "Mặc định cho dòng thiếu trạng thái",
    };
  }

  const found = CANONICAL_STATUS_REGISTRY[clean];
  if (found) {
    return found;
  }

  // Fallback an toàn cho trạng thái mới chưa có trong từ điển
  return {
    canonicalName: String(rawStatus).trim(),
    category: "SOURCE",
    endsAssignment: false,
    warnsDuplicate: false,
    description: "Trạng thái nguồn mới",
  };
}
