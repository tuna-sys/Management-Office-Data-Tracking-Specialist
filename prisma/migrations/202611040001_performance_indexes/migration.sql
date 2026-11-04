-- Add indexes for common list filters, joins, and deterministic pagination.
CREATE INDEX "Worker_archivedAt_createdAt_idx" ON "Worker"("archivedAt", "createdAt");
CREATE INDEX "WorkAssignment_workerId_createdAt_idx" ON "WorkAssignment"("workerId", "createdAt");
CREATE INDEX "BonusRecord_createdAt_idx" ON "BonusRecord"("createdAt");
CREATE INDEX "BonusRecord_month_company_createdAt_idx" ON "BonusRecord"("month", "company", "createdAt");
CREATE INDEX "BonusRecord_workerId_createdAt_idx" ON "BonusRecord"("workerId", "createdAt");
CREATE INDEX "BonusRecord_assignmentId_idx" ON "BonusRecord"("assignmentId");
CREATE INDEX "BankAccount_workerId_createdAt_idx" ON "BankAccount"("workerId", "createdAt");
CREATE INDEX "AuditLog_action_module_createdAt_idx" ON "AuditLog"("action", "module", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AssignmentEvent_assignmentId_createdAt_idx" ON "AssignmentEvent"("assignmentId", "createdAt");
