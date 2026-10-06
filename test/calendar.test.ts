import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBusinessDays, addDays, bogotaDate, businessDaysBetween, easter, holidayName, holidays, isBusinessDay, nextBusinessDay } from '../src/domain/calendar';
import { atRiskThreshold, computeDeadline, slaFor } from '../src/domain/deadlines';

test('Easter dates', () => {
  assert.equal(easter(2024), '2024-03-31');
  assert.equal(easter(2025), '2025-04-20');
  assert.equal(easter(2026), '2026-04-05');
});

test('2025 holidays match the official calendar', () => {
  const h = holidays(2025);
  for (const d of ['2025-01-01', '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-05-01', '2025-06-02', '2025-06-23', '2025-06-30', '2025-07-20', '2025-08-07', '2025-08-18', '2025-10-13', '2025-11-03', '2025-11-17', '2025-12-08', '2025-12-25']) {
    assert.ok(h.has(d), `falta festivo ${d}`);
  }
  // 18 distinct dates: 20 Jul (Sunday) and 29 Jun/Sagrado Corazón collide on 30 Jun
  assert.ok(h.size >= 17 && h.size <= 19);
});

test('2026 holidays match the official calendar', () => {
  const h = holidays(2026);
  for (const d of ['2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16']) {
    assert.ok(h.has(d), `falta festivo ${d}`);
  }
});

test('Emiliani holidays that already fall on a Monday do not move', () => {
  assert.equal(holidayName('2026-06-29'), 'San Pedro y San Pablo');
  assert.equal(holidayName('2026-10-12'), 'Día de la Raza');
  assert.equal(holidayName('2026-06-30'), null);
});

test('business-day predicate', () => {
  assert.equal(isBusinessDay('2025-03-21'), true); // Friday
  assert.equal(isBusinessDay('2025-03-22'), false); // Saturday
  assert.equal(isBusinessDay('2025-03-23'), false); // Sunday
  assert.equal(isBusinessDay('2025-03-24'), false); // San José (moved)
  assert.equal(nextBusinessDay('2025-03-22'), '2025-03-25');
  assert.equal(nextBusinessDay('2025-03-25'), '2025-03-25');
});

test('addBusinessDays skips weekends and holidays and never counts the start day', () => {
  assert.equal(addBusinessDays('2025-03-17', 0), '2025-03-17');
  assert.equal(addBusinessDays('2025-03-17', 1), '2025-03-18');
  assert.equal(addBusinessDays('2025-03-21', 1), '2025-03-25'); // Fri → (Sat, Sun, Mon holiday) → Tue
  // 15 business days from Mon 2025-03-03: 3 weeks → Mon 2025-03-24 is a holiday → Tue 2025-03-25
  assert.equal(addBusinessDays('2025-03-03', 15), '2025-03-25');
  // Holy week 2025: from Mon 14 Apr, 5 business days → Thu 17 and Fri 18 are holidays → Wed 23 Apr
  assert.equal(addBusinessDays('2025-04-14', 5), '2025-04-23');
});

test('businessDaysBetween is signed and consistent with addBusinessDays', () => {
  assert.equal(businessDaysBetween('2025-03-17', '2025-03-17'), 0);
  assert.equal(businessDaysBetween('2025-03-17', '2025-03-21'), 4);
  assert.equal(businessDaysBetween('2025-03-21', '2025-03-17'), -4);
  for (const start of ['2025-03-03', '2025-06-10', '2025-12-18', '2026-01-02']) {
    for (const n of [1, 5, 10, 15, 30]) {
      const end = addBusinessDays(start, n);
      assert.equal(businessDaysBetween(start, end), n, `${start} +${n}`);
      assert.ok(isBusinessDay(end));
    }
  }
});

test('year boundary and leap years', () => {
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addBusinessDays('2025-12-22', 5), '2025-12-30'); // 23, 24, (25 holiday), 26, 29, 30
});

test('bogotaDate uses UTC-5', () => {
  assert.equal(bogotaDate('2025-03-17T03:00:00Z'), '2025-03-16');
  assert.equal(bogotaDate('2025-03-17T05:00:00Z'), '2025-03-17');
});

test('legal deadlines per type', () => {
  assert.equal(computeDeadline('2025-03-03', 'peticion', 'general').legalDays, 15);
  assert.equal(computeDeadline('2025-03-03', 'peticion', 'information').legalDays, 10);
  assert.equal(computeDeadline('2025-03-03', 'peticion', 'consultation').legalDays, 30);
  assert.equal(computeDeadline('2025-03-03', 'peticion', null).legalDays, 15);
  assert.equal(computeDeadline('2025-03-03', 'reclamo', null).legalDays, 15);
  const den = computeDeadline('2025-03-03', 'denuncia', null, { denunciaDays: 20 });
  assert.equal(den.legalDays, 20);
  assert.equal(den.verify, true);
});

test('a case received on a weekend counts from the next business day', () => {
  const sat = computeDeadline('2025-03-01', 'peticion', 'information'); // Saturday
  assert.equal(sat.countFrom, '2025-03-03');
  assert.equal(sat.dueDate, addBusinessDays('2025-03-03', 10));
  const mon = computeDeadline('2025-03-03', 'peticion', 'information');
  assert.equal(mon.dueDate, sat.dueDate);
});

test('SLA states', () => {
  const due = '2025-03-25';
  assert.equal(slaFor('2025-03-03', due, 15, false).slaStatus, 'on_time');
  assert.equal(slaFor('2025-03-20', due, 15, false).slaStatus, 'at_risk'); // 2 business days left
  assert.equal(slaFor('2025-03-25', due, 15, false).slaStatus, 'at_risk'); // due today is not late yet
  assert.equal(slaFor('2025-03-26', due, 15, false).slaStatus, 'overdue');
  assert.equal(slaFor('2025-03-26', due, 15, false).businessDaysLeft, -1);
  assert.equal(slaFor('2025-04-30', due, 15, true).slaStatus, 'done');
  assert.equal(atRiskThreshold(10), 3);
  assert.equal(atRiskThreshold(30), 6);
});
