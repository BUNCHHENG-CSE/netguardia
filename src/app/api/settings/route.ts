import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonResponse, errorResponse } from '@/lib/apiUtils';

export async function GET() {
  const row = (await prisma.backupSettings.findUnique({ where: { id: 1 } })) || {
    id: 1,
    scheduleEnabled: 1,
    intervalMinutes: 360,
    cronExpression: '0 */6 * * *',
    noiseFilterEnabled: 1,
    alertOnOutOfWindow: 1,
    staleBackupThresholdDays: 7,
    webhookUrl: '',
    notificationEmail: '',
    lastGlobalRunAt: null,
    lastReadinessAuditAt: null,
  };

  return jsonResponse({
    id: row.id,
    schedule_enabled: row.scheduleEnabled === 1,
    interval_minutes: row.intervalMinutes,
    cron_expression: row.cronExpression,
    noise_filter_enabled: row.noiseFilterEnabled === 1,
    alert_on_out_of_window: row.alertOnOutOfWindow === 1,
    stale_backup_threshold_days: row.staleBackupThresholdDays,
    webhook_url: row.webhookUrl || '',
    notification_email: row.notificationEmail || '',
    last_global_run_at: row.lastGlobalRunAt,
    last_readiness_audit_at: row.lastReadinessAuditAt,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      schedule_enabled = true,
      interval_minutes = 360,
      cron_expression = '0 */6 * * *',
      noise_filter_enabled = true,
      alert_on_out_of_window = true,
      stale_backup_threshold_days = 7,
      webhook_url = '',
      notification_email = '',
    } = body;

    const updated = await prisma.backupSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        scheduleEnabled: schedule_enabled ? 1 : 0,
        intervalMinutes: Number(interval_minutes),
        cronExpression: cron_expression,
        noiseFilterEnabled: noise_filter_enabled ? 1 : 0,
        alertOnOutOfWindow: alert_on_out_of_window ? 1 : 0,
        staleBackupThresholdDays: Number(stale_backup_threshold_days),
        webhookUrl: webhook_url,
        notificationEmail: notification_email,
      },
      update: {
        scheduleEnabled: schedule_enabled ? 1 : 0,
        intervalMinutes: Number(interval_minutes),
        cronExpression: cron_expression,
        noiseFilterEnabled: noise_filter_enabled ? 1 : 0,
        alertOnOutOfWindow: alert_on_out_of_window ? 1 : 0,
        staleBackupThresholdDays: Number(stale_backup_threshold_days),
        webhookUrl: webhook_url,
        notificationEmail: notification_email,
      },
    });

    return jsonResponse({
      id: updated.id,
      schedule_enabled: updated.scheduleEnabled === 1,
      interval_minutes: updated.intervalMinutes,
      cron_expression: updated.cronExpression,
      noise_filter_enabled: updated.noiseFilterEnabled === 1,
      alert_on_out_of_window: updated.alertOnOutOfWindow === 1,
      stale_backup_threshold_days: updated.staleBackupThresholdDays,
      webhook_url: updated.webhookUrl || '',
      notification_email: updated.notificationEmail || '',
      last_global_run_at: updated.lastGlobalRunAt,
      last_readiness_audit_at: updated.lastReadinessAuditAt,
    });
  } catch (err: any) {
    return errorResponse(err.message, 400);
  }
}
