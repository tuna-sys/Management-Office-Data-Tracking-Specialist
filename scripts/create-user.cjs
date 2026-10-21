const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const file = path.resolve(process.env.LOCAL_AUTH_FILE || ".local/auth.json");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  // Nhập tên đăng nhập (mặc định 'admin' nếu bỏ trống)
  const usernameInput = await ask("Tên đăng nhập: ");
  const username = usernameInput.trim() || "admin";

  // Nhập vai trò (mặc định 'ADMIN' nếu bỏ trống/nhập sai)
  const roleInput = await ask("Vai trò (ADMIN/HR/FINANCE/VIEWER): ");
  const role = roleInput.trim().toUpperCase() || "ADMIN";

  // Nhập mật khẩu (ẩn chữ khi gõ)
  rl.stdoutMuted = true;
  const originalWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!rl.stdoutMuted) originalWrite(text);
  };

  process.stdout.write("Mật khẩu: ");
  const password = await ask("");
  rl.stdoutMuted = false;
  process.stdout.write("\n");
  rl.close();

  // Kiểm tra file đã tồn tại hay chưa
  if (fs.existsSync(file)) {
    throw new Error(
      "Tài khoản đã được khởi tạo. Hãy quản lý tài khoản tại màn hình Phân quyền.",
    );
  }

  const config = { secret: crypto.randomBytes(32).toString("hex"), users: [] };
  const salt = crypto.randomBytes(16).toString("hex");

  config.users.push({
    username,
    role,
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex"),
    version: crypto.randomUUID(),
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), {
    mode: 0o600,
    flag: "wx",
  });

  console.log(`Đã tạo thành công tài khoản: ${username} với vai trò: ${role}`);
})().catch((err) => {
  rl.close();
  console.error(err.message);
  process.exitCode = 1;
});
