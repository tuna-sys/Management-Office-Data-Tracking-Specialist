import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guard, identity } from '@/lib/auth';
import { deleteImportSource } from '@/lib/import-source-store';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function GET(request: NextRequest) {
  const denied = await guard(request, 'worker:write');
  if (denied) return denied;

  try {
    const importedEvents = await prisma.assignmentEvent.count({
      where: { note: { startsWith: 'Import Excel' } }
    });
    const totalWorkers = await prisma.worker.count();
    const totalAssignments = await prisma.workAssignment.count();
    const totalBonuses = await prisma.bonusRecord.count();
    const totalBanks = await prisma.bankAccount.count();

    return NextResponse.json({
      success: true,
      stats: {
        importedEvents,
        totalWorkers,
        totalAssignments,
        totalBonuses,
        totalBanks
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err?.message || 'Lỗi truy vấn dữ liệu' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'worker:write');
  if (denied) return denied;

  const actor = (await identity(request))!;

  try {
    // 1. Sao lưu CSDL an toàn trước khi xóa
    const settingsPath = path.resolve('.local/evolution-preview.json');
    const preview = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
    const dbUrl = process.env.LOCAL_APPLICATION_DATABASE_URL || preview?.databaseUrl || 'file:./prisma/dev.db';
    const dbFilePath = dbUrl.replace(/^file:/, '');

    const backupDir = path.resolve('.local/backups');
    await mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `before-clear-excel-${timestamp}.db`);

    if (existsSync(dbFilePath)) {
      await copyFile(dbFilePath, backupFile);
    }

    // 2. Thu thập và xóa dữ liệu nạp từ Excel
    // 2. Thu thập và xóa dữ liệu nạp từ Excel
    const result = await prisma.$transaction(async (tx) => {
      // 1. Tạo bảng tạm chứa các assignmentId được tạo từ import
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE TempImportAssignments (id TEXT PRIMARY KEY)`);
      await tx.$executeRawUnsafe(`
        INSERT OR IGNORE INTO TempImportAssignments (id)
        SELECT DISTINCT assignmentId FROM AssignmentEvent WHERE note LIKE 'Import Excel%'
      `);

      // 2. Xóa các khoản thanh toán & mốc thưởng chính sách (RewardPayment -> RewardStage -> PolicyEnrollment)
      await tx.$executeRawUnsafe(`
        DELETE FROM RewardPayment WHERE stageId IN (
          SELECT id FROM RewardStage WHERE enrollmentId IN (
            SELECT id FROM PolicyEnrollment WHERE assignmentId IN (SELECT id FROM TempImportAssignments)
          )
        )
      `);
      await tx.$executeRawUnsafe(`
        DELETE FROM RewardStage WHERE enrollmentId IN (
          SELECT id FROM PolicyEnrollment WHERE assignmentId IN (SELECT id FROM TempImportAssignments)
        )
      `);
      await tx.$executeRawUnsafe(`
        DELETE FROM PolicyEnrollment WHERE assignmentId IN (SELECT id FROM TempImportAssignments)
      `);

      // 3. Xóa các bản ghi thưởng (BonusRecord)
      const deletedBonuses = await tx.$executeRawUnsafe(`
        DELETE FROM BonusRecord 
        WHERE note LIKE '%SOURCE_EXCEL_ACTUAL_PAID%' 
           OR assignmentId IN (SELECT id FROM TempImportAssignments)
      `);

      // 4. Xóa sự kiện đợt tuyển (AssignmentEvent)
      await tx.$executeRawUnsafe(`
        DELETE FROM AssignmentEvent WHERE assignmentId IN (SELECT id FROM TempImportAssignments)
      `);

      // 5. Xóa đợt tuyển (WorkAssignment)
      const deletedAssignments = await tx.$executeRawUnsafe(`
        DELETE FROM WorkAssignment WHERE id IN (SELECT id FROM TempImportAssignments)
      `);

      // 6. Tìm và xóa tài khoản ngân hàng của những worker không còn đợt tuyển nào
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE TempOrphanWorkers (id TEXT PRIMARY KEY)`);
      await tx.$executeRawUnsafe(`
        INSERT OR IGNORE INTO TempOrphanWorkers (id)
        SELECT id FROM Worker WHERE id NOT IN (SELECT DISTINCT workerId FROM WorkAssignment WHERE workerId IS NOT NULL)
      `);
      const deletedBanks = await tx.$executeRawUnsafe(`
        DELETE FROM BankAccount WHERE workerId IN (SELECT id FROM TempOrphanWorkers)
           OR checkResult LIKE '%Tự động tạo từ danh sách thưởng%' 
           OR checkResult LIKE '%Đối soát%'
      `);

      // 7. Xóa worker không còn đợt tuyển
      const deletedWorkers = await tx.$executeRawUnsafe(`
        DELETE FROM Worker WHERE id IN (SELECT id FROM TempOrphanWorkers)
      `);

      // Dọn dẹp bảng tạm
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS TempImportAssignments`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS TempOrphanWorkers`);

      // Ghi audit log
      await tx.auditLog.create({
        data: {
          module: 'EXCEL',
          action: 'CLEAR_DATA',
          operator: actor.username,
          details: `Dọn dẹp dữ liệu import: xóa ${deletedWorkers} công nhân, ${deletedAssignments} lượt tuyển, ${deletedBonuses} bản thưởng, ${deletedBanks} STK. Sao lưu tại: ${path.basename(backupFile)}`
        }
      });

      return {
        workers: deletedWorkers,
        assignments: deletedAssignments,
        bonuses: deletedBonuses,
        bankAccounts: deletedBanks
      };
    }, { timeout: 60000 });

    // 3. Xóa các file lưu nguồn review trong .local/source-imports/
    await deleteImportSource();

    return NextResponse.json({
      success: true,
      message: `Đã dọn dẹp thành công ${result.workers} công nhân, ${result.assignments} lượt tuyển, ${result.bonuses} bản thưởng. Đã sao lưu dữ liệu dự phòng.`,
      backup: path.basename(backupFile),
      cleared: result
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      message: 'Không thể dọn dẹp dữ liệu: ' + (err?.message || 'Lỗi không xác định')
    }, { status: 500 });
  }
}
