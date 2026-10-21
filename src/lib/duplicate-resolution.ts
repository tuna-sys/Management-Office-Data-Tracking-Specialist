import { parseBonusImportRow } from "@/lib/bonus-import";
import { createHash } from 'node:crypto';
import { dateKey, formatExcelDate, validateWorker } from '@/lib/worker-validation';
import { assertDailyInterview, assertIdentity, assertSourceCard, sameInterviewDay, sourceConflicts } from '@/lib/duplicate-check';
import { parseImportRow, inferProvince } from '@/lib/worker-import';
import { assignmentRelations } from '@/lib/domain';
type Candidate = {
    key: string;
    label: string;
    before: any;
    after: any;
};
export function reviewToken(worker: any, assignment: any, raw: any) {
    const pick = (v: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, v?.[k] ?? null]));
    const w = pick(worker, ['id', 'idCard', 'fullName', 'phone', 'gender', 'dob', 'address', 'province', 'updatedAt']);
    const a = pick(assignment, ['id', 'workerId', 'interviewFactory', 'interviewDate', 'employeeCode', 'status', 'leaveDate', 'leaveReason', 'recruiter', 'updatedAt']);
    const days = (worker?.assignments || []).map((v: any) => pick(v, ['id', 'interviewDate', 'updatedAt'])).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    return createHash('sha256').update(JSON.stringify({ worker: w, assignment: a, days, raw })).digest('hex');
}
export function reviewFields(worker: any, a: any, raw: any): Candidate[] {
    const address = raw['Địa chỉ'] || raw['Quê quán'];
    const values: Array<[
        string,
        string,
        any
    ]> = [
        ['worker.fullName', 'Họ và tên', raw['Họ và tên'] || raw['Họ tên']], ['worker.phone', 'SĐT', raw['SĐT'] || raw['Số điện thoại']],
        ['worker.gender', 'Giới tính', raw['Giới tính']], ['worker.dob', 'Ngày sinh', formatExcelDate(raw['Ngày sinh'])],
        ['worker.address', 'Địa chỉ/Quê quán', address], ['worker.province', 'Tỉnh/Thành', raw['Tỉnh/Thành'] || raw['Tỉnh'] || inferProvince(address || '')],
        ['assignment.interviewFactory', 'Nhà máy phỏng vấn', raw['Nhà máy PV']],
        ['assignment.employeeCode', 'Mã nhân viên', raw['Mã NV'] || raw['Mã nhân viên']], ['assignment.interviewDate', 'Ngày PV', formatExcelDate(raw['Ngày PV'] || raw['Ngày phỏng vấn'])],
        ['assignment.status', 'Trạng thái', raw['Tình trạng']], ['assignment.leaveDate', 'Ngày nghỉ', formatExcelDate(raw['Ngày NH'] || raw['Ngày nghỉ'])],
        ['assignment.leaveReason', 'Lý do nghỉ', raw['Lý do']], ['assignment.recruiter', 'Người tuyển dụng', raw['Tuyển dụng'] || raw['Người tuyển']],
    ];
    return values.filter(([, , value]) => value != null && String(value).trim() !== '').map(([key, label, value]) => ({ key, label, before: key.startsWith('worker.') ? worker?.[key.split('.')[1]] : a?.[key.split('.')[1]], after: String(value).trim() })).filter(f => String(f.before || '') !== f.after);
}
export async function resolveReview(tx: any, source: any, row: any, body: any, actor: string) {
    const simpleApprove = body.resolution === 'APPROVE_SOURCE';
    const simpleDiscard = body.resolution === 'DISCARD_SOURCE';
    const originalDecision = body.resolution;
    if (simpleApprove || simpleDiscard) body = {...body, resolution:simpleDiscard?'KEEP_EXISTING':'APPLY_FIELDS', reviewerNote:simpleDiscard?'Người duyệt bỏ qua dòng nhập mới':'Người duyệt xác nhận áp dụng dữ liệu nguồn và lưu lịch sử trước thay đổi'};
    const note = typeof body.reviewerNote === 'string' ? body.reviewerNote.trim() : '';
    if (body.confirmResolution !== true || !note || note.length > 1000)
        throw new Error('Cần xác nhận quyết định và ghi lý do duyệt (tối đa 1000 ký tự)');
    if (!['KEEP_EXISTING', 'APPLY_FIELDS', 'NEW_INTERVIEW'].includes(body.resolution))
        throw new Error('Quyết định duyệt không hợp lệ');
    const raw = row.values || {};
    const card = String(raw['Số CCCD'] || raw['số CCCD'] || raw.CCCD || '').replace(/\s+/g, '');
    const worker = await tx.worker.findUnique({ where: { idCard: card }, include: { assignments: true } });
    if (!worker && body.resolution !== 'KEEP_EXISTING')
        throw new Error('Không tìm thấy hồ sơ để đối chiếu; tải lại danh sách');
    const matches = (worker?.assignments || []).filter((a: any) => sameInterviewDay(a, { interviewDate: formatExcelDate(raw['Ngày PV'] || raw['Ngày phỏng vấn']) }));
    const assignment = body.targetAssignmentId ? (worker?.assignments || []).find((a: any) => a.id === body.targetAssignmentId) : matches.length === 1 ? matches[0] : null;
    if (body.targetAssignmentId && !assignment)
        throw new Error('Đợt tuyển không thuộc người lao động');
    if (body.reviewToken !== reviewToken(worker, assignment, raw))
        throw new Error('Dữ liệu đã thay đổi; tải lại để đối chiếu trước khi duyệt');
    const sourceKey = 'review-source:' + source.id + ':' + row.row + ':' + body.reviewToken;
    const prior = await tx.auditLog.findFirst({ where: { module: 'DUPLICATE_REVIEW', action: 'REVIEW_SOURCE', details: { contains: sourceKey } } });
    if (prior)
        throw new Error('Dòng đã được người duyệt xử lý; tải lại danh sách');
    const before = JSON.parse(JSON.stringify({ worker, assignment }));
    let after: any = before, changes: Candidate[] = [], created: any = null, remaining = true;
    if (body.resolution === 'APPLY_FIELDS') {
        if (!assignment)
            throw new Error('Cần chọn đúng một lượt tuyển để sửa các trường đã xác minh');
        const selected = simpleApprove ? reviewFields(worker, assignment, raw).map(f=>f.key) : body.selectedFields;
        if (!Array.isArray(selected) || (!simpleApprove && !selected.length) || selected.length > 20)
            throw new Error('Cần chọn các trường muốn áp dụng');
        const candidates = reviewFields(worker, assignment, raw);
        if (selected.some((key: any) => typeof key !== 'string' || !candidates.some(c => c.key === key)))
            throw new Error('Có trường không hợp lệ hoặc không có thay đổi');
        changes = candidates.filter(c => selected.includes(c.key));
        const workerPatch: any = {}, assignmentPatch: any = {};
        for (const f of changes)
            (f.key.startsWith('worker.') ? workerPatch : assignmentPatch)[f.key.split('.')[1]] = f.after;
        const merged = { ...assignment, ...assignmentPatch };
        assertDailyInterview(worker, merged, assignment.id);
        if (merged.leaveDate && dateKey(merged.leaveDate)! < dateKey(merged.interviewDate)!)
            throw new Error('Ngày nghỉ không được trước ngày phỏng vấn');
        validateWorker({ ...worker, ...workerPatch }, merged, true, true);
        if (["interviewFactory", "interviewFactoryId", "workingFactory", "workingFactoryId", "status", "statusId"].some((k) => k in assignmentPatch)) {
            await assignmentRelations(tx, merged, assignment);
            for (const key of ["interviewFactory", "interviewFactoryId", "workingFactory", "workingFactoryId", "status", "statusId"])
                if (merged[key] !== assignment[key]) assignmentPatch[key] = merged[key];
        }
        if (['interviewFactory', 'interviewDate', 'employeeCode'].some(k => k in assignmentPatch) && await tx.policyEnrollment.count({ where: { assignmentId: assignment.id } }))
            throw new Error('Đợt đã áp dụng chính sách: cần xử lý điều chỉnh thưởng trước khi thay thông tin liên kết');
        if (Object.keys(workerPatch).length)
            await tx.worker.update({ where: { id: worker.id }, data: workerPatch });
        if (Object.keys(assignmentPatch).length)
            await tx.workAssignment.update({ where: { id: assignment.id }, data: assignmentPatch });
        after = { worker: { ...before.worker, ...workerPatch }, assignment: merged };
        remaining = sourceConflicts({ ...worker, ...workerPatch, assignments: worker.assignments.map((a: any) => a.id === assignment.id ? merged : a) }, raw).length > 0;
    }
    else if (body.resolution === 'NEW_INTERVIEW') {
        const corrected = dateKey(body.correctedInterviewDate || '');
        if (!corrected)
            throw new Error('Cần ngày PV đã xác minh hợp lệ');
        assertDailyInterview(worker, { interviewDate: corrected });
        assertIdentity(worker, String(raw['Họ và tên'] || raw['Họ tên'] || ''));
        const normalized = { ...raw, 'Ngày PV': corrected, 'Nhà máy PV': raw['Nhà máy PV'] || raw['Công ty'] };
        const parsed = parseImportRow(normalized, true);
        assertSourceCard(raw, parsed.worker.idCard);
        const data: any = { ...parsed.assignment, interviewDate: corrected, workerId: worker.id };
        for (const key of ['orderId', 'batchId'])
            if (!data[key])
                delete data[key];
        if (data.leaveDate && dateKey(data.leaveDate)! < corrected)
            throw new Error('Ngày nghỉ không được trước ngày PV đã sửa');
        await assignmentRelations(tx, data);
        created = await tx.workAssignment.create({ data });
        after = { worker: before.worker, assignment: created };
    }
    if(simpleApprove && source.type==='DS_THUONG'){
      const parsed=parseBonusImportRow(raw);
      const current=await tx.bonusRecord.findFirst({where:{workerId:worker.id,month:parsed.month,company:parsed.company,assignmentId:assignment.id}});
      if(current && current.status!=='DRAFT') throw new Error('Bản thưởng đã duyệt/khóa; không thể ghi đè');
      const data:any={workerId:worker.id,assignmentId:assignment.id,company:parsed.company,month:parsed.month,interviewDate:parsed.interviewDate,policy:parsed.policy,workerCode:parsed.workerCode,...Object.fromEntries(parsed.bonuses.map((n:number,i:number)=>['bonus'+(i+1),n])),totalBonus:parsed.totalBonus,note:JSON.stringify({source:'SOURCE_EXCEL_ACTUAL_PAID',sourceValues:raw,rewards:Array.from({length:7},(_,i)=>String(raw['Thưởng lần '+(i+1)]||''))})};
      const saved=current?await tx.bonusRecord.update({where:{id:current.id},data}):await tx.bonusRecord.create({data:{...data,status:'DRAFT'}});
      before.bonus=current||null;after={...after,bonus:saved};
    }
    const summary = body.resolution === 'KEEP_EXISTING' ? 'Giữ hồ sơ hiện có, bỏ qua dòng nhập mới' : body.resolution === 'NEW_INTERVIEW' ? 'Ghi nhận lượt tuyển riêng theo ngày PV đã xác minh' : changes.map(f => f.label + ': ' + String(f.before || 'trống') + ' → ' + f.after).join('; ');
    const history = { sourceKey, decision: originalDecision, reviewer: actor, reason: note, source: { id: source.id, file: source.file, type: source.type, row: row.row, values: raw }, before, after, changes };
    await tx.auditLog.create({ data: { module: 'DUPLICATE_REVIEW', action: 'REVIEW_SOURCE', operator: actor, details: JSON.stringify(history) } });
    const target = created || after.assignment || assignment;
    if (target)
        await tx.assignmentEvent.create({ data: { assignmentId: target.id, occurredOn: new Date().toISOString().slice(0, 10), fromStatus: created ? null : before.assignment?.status || null, toStatus: target.status, operator: actor, note: 'Duyệt đối chiếu: ' + summary + '. Lý do: ' + note + '. File ' + source.file + ' dòng ' + row.row } });
    // A selected correction can leave other conflicts unresolved; keep the original row for further comparison.
    return { removeSource: simpleApprove || simpleDiscard || body.resolution === 'KEEP_EXISTING' || (source.type === 'DS_TONG' && (body.resolution === 'NEW_INTERVIEW' || (body.resolution === 'APPLY_FIELDS' && !remaining))), correctedInterviewDate: body.resolution === 'NEW_INTERVIEW' ? body.correctedInterviewDate : null, message: (simpleApprove ? "Đã duyệt dữ liệu mới và lưu lịch sử trước/sau" : summary) + (!simpleApprove && body.resolution === "APPLY_FIELDS" && remaining ? ". Các điểm mâu thuẫn chưa chọn vẫn giữ trong hàng chờ đối chiếu." : "") };
}
