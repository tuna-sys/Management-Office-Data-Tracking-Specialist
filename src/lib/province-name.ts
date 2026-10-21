// Normalize labels for reporting only; preserve original worker/source values.
export function provinceName(value: unknown, address: unknown = ""): string {
  const clean = (text: string) => text.normalize("NFC").replace(/\s+/g, " ")
    .replace(/^(tỉnh|thành phố|tp\.?)\s+/i, "").trim();
  let name = clean(String(value ?? ""));
  if (!name) {
    const parts = String(address ?? "").split(/[,-]/).map(clean).filter(Boolean);
    name = parts[parts.length - 1] || "";
  }
  const repeated = name.split(/[.,;]+/).map(clean).filter(Boolean);
  if (repeated.length > 1 && repeated.every(part => part.toLocaleLowerCase("vi") === repeated[0].toLocaleLowerCase("vi"))) {
    name = repeated[0];
  }
  // Confirmed source typo; do not guess other unknown place names.
  if (name.toLocaleLowerCase("vi") === "quảng bìnhf") return "Quảng Bình";
  return name;
}
