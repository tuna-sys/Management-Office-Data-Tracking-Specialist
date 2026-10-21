import * as XLSX from "xlsx";

export interface RawWorkerRow {
  STT?: any;
  "Nhà máy PV"?: string;
  "Loại HD"?: string;
  "Tình trạng "?: string;
  "Tình trạng"?: string;
  "Ngày NH "?: any;
  "Ngày NH"?: any;
  "Lý do"?: string;
  "Mã NV"?: string;
  "Họ và tên "?: string;
  "Họ và tên"?: string;
  "Ngày sinh"?: any;
  "Giới tính "?: string;
  "Giới tính"?: string;
  "số CCCD"?: any;
  "Số CCCD"?: any;
  CCCD?: any;
  "Ngày cấp"?: any;
  "Địa chỉ"?: string;
  SĐT?: any;
  "Tuyển dụng"?: string;
  "Đón xe - KTX"?: string;
  "Ngày PV"?: any;
  "Ngày Đào tạo dự kiến "?: any;
  "Tình trạng Đào tạo dự kiến "?: any;
  "Ngày đào tạo chuẩn"?: any;
  "Tháng nhận việc "?: any;
  "Tháng nhận việc"?: any;
  "Nguồn "?: string;
  Nguồn?: string;
}

export function parseExcelBuffer(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: "",
  });
}

export function generateExcelBuffer(data: any[], sheetName = "Sheet1"): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
