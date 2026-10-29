/**
 * Automated Daily Audit & Monthly Salary Rollover Service
 * - Automatically posts recurring fixed expenses and staff salaries on the 1st of every month
 *   (and immediately after 12:00 AM midnight of the last date of the month).
 * - Does NOT generate unsolicited fake/auto-spam vehicle notifications on boot.
 */

import { autoPostMonthlyRecurringAndSalaries, saveNotificationToFirestore } from './dbService';
import { safeAppStorage } from './storage';
import { UserRole } from '../types';

const LAST_SALARY_ROLLOVER_KEY = 'dpl_last_salary_rollover_month';

export async function notifyLiveFinanceTransaction(params: {
  direction: 'PAID' | 'RECEIVED';
  amount: number;
  party: string;
  description: string;
  paymentMethod?: string;
  caseNo?: string;
  reference?: string;
}): Promise<void> {
  try {
    const isPaid = params.direction === 'PAID';
    const amtStr = Number(params.amount || 0).toLocaleString();
    await saveNotificationToFirestore({
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: isPaid
        ? `Payment Paid — PKR ${amtStr} (${params.party || 'Vendor/Staff'})`
        : `Payment Received — PKR ${amtStr} (${params.party || 'Client'})`,
      description: `${params.description || 'Financial transaction recorded'}${params.caseNo ? ` | Case: ${params.caseNo}` : ''}${params.paymentMethod ? ` | Mode: ${params.paymentMethod}` : ''}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'SUCCESS',
      category: 'FINANCE',
      status: 'PENDING',
      targetRole: [UserRole.ADMIN, UserRole.FINANCE_MANAGER],
      targetClientName: !isPaid && params.party ? params.party : undefined,
      notificationSubType: 'FINANCE_RECORDED',
      targetView: 'finance',
      targetFilter: params.caseNo ? { caseNo: params.caseNo } : undefined,
      actionLabel: 'View Finance'
    });
  } catch (err) {
    console.warn('notifyLiveFinanceTransaction notice:', err);
  }
}

export async function runMonthlySalaryRolloverCheck(): Promise<void> {
  try {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastProcessedMonth = safeAppStorage.getItem(LAST_SALARY_ROLLOVER_KEY);

    if (lastProcessedMonth !== currentMonthKey) {
      await autoPostMonthlyRecurringAndSalaries();
      safeAppStorage.setItem(LAST_SALARY_ROLLOVER_KEY, currentMonthKey);
    }
  } catch (err) {
    console.warn('Monthly salary rollover check notice:', err);
  }
}

export async function runDailyAutomatedAudit(force = false): Promise<void> {
  if (force) {
    await runMonthlySalaryRolloverCheck();
  }
}

let schedulerInterval: any = null;

export function initAuditSchedulerService(): void {
  if (schedulerInterval) return;

  // Run monthly rollover check after a brief delay
  setTimeout(() => {
    runMonthlySalaryRolloverCheck().catch(() => {});
  }, 4000);

  schedulerInterval = setInterval(() => {
    runMonthlySalaryRolloverCheck().catch(() => {});
  }, 15 * 60 * 1000);
}
