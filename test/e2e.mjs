// End-to-end UI test against the local mock. Usage: node test/e2e.mjs <shots-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = process.argv[2] || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:8787';
const errors = [];
const log = (...a) => console.log('•', ...a);

const browser = await chromium.launch();
async function session(user, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'he-IL', acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__toasts = []; const seen = new WeakSet();
    setInterval(() => document.querySelectorAll('.toast').forEach((n) => { if (!seen.has(n)) { seen.add(n); window.__toasts.push(n.textContent); } }), 50);
  });
  page.on('pageerror', (e) => errors.push(`${user}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${user}: console ${m.text()}`); });
  await page.goto(BASE);
  await page.getByLabel('שם משתמש').fill(user);
  await page.getByLabel('סיסמה').fill('Test1234!');
  await page.getByRole('button', { name: 'כניסה למערכת' }).click();
  await page.waitForSelector('.top-title h1');
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const toastText = async (page) => {
  const n = page.__n ?? 0;
  await page.waitForFunction((k) => window.__toasts.length > k, n, { timeout: 8000 });
  const all = await page.evaluate(() => window.__toasts); page.__n = all.length; return all.slice(n).join(' + ');
};

// ---------- bad login ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await shot(page, '00-login');
  await page.getByLabel('שם משתמש').fill('romy'); await page.getByLabel('סיסמה').fill('wrong');
  await page.getByRole('button', { name: 'כניסה למערכת' }).click();
  log('bad login ->', await page.locator('.form-error').textContent());
  await ctx.close();
}

// ---------- admin ----------
{
  const { ctx, page } = await session('romy');
  await page.waitForSelector('.kpi');
  await page.waitForTimeout(300);
  await shot(page, '01-dashboard');
  log('dashboard KPIs:', (await page.locator('.kpi-value').allTextContents()).join(' | '));
  await page.locator('.bar-row').first().click();
  await page.waitForTimeout(200);
  await shot(page, '02-dashboard-division');

  // budget
  await page.goto(`${BASE}/#/budget`);
  await page.waitForSelector('table.grid tbody tr');
  log('budget rows:', await page.locator('table.grid tbody tr').count());
  await shot(page, '03-budget');
  await page.getByLabel('חריגות בלבד').check();
  log('overruns:', await page.locator('table.grid tbody tr').count());
  await page.getByLabel('חריגות בלבד').uncheck();
  // edit first row
  await page.locator('table.grid tbody tr').first().click();
  await page.waitForSelector('.modal');
  await shot(page, '04-budget-edit');
  const inp = page.locator('.modal').getByLabel('ביצוע 2026 (₪)');
  const before = await inp.inputValue();
  await inp.fill(String(Number(before) + 12345));
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('edit budget ->', await toastText(page));
  // new item
  await page.getByRole('button', { name: '+ סעיף חדש' }).click();
  await page.locator('.modal').getByLabel('קוד סעיף').fill('2-99-99-999');
  await page.locator('.modal').getByLabel('שם סעיף').fill('סעיף בדיקה חדש');
  await page.locator('.modal').getByLabel('אגף').selectOption({ label: 'מינהל חינוך' });
  await page.locator('.modal').getByLabel('מחלקה').selectOption({ label: 'חינוך יסודי' });
  await page.locator('.modal').getByLabel('תקציב 2026 (₪)').fill('500000');
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('new budget item ->', await toastText(page));
  // duplicate code
  await page.getByRole('button', { name: '+ סעיף חדש' }).click();
  await page.locator('.modal').getByLabel('קוד סעיף').fill('2-99-99-999');
  await page.locator('.modal').getByLabel('שם סעיף').fill('כפול');
  await page.locator('.modal').getByLabel('מחלקה').selectOption({ index: 1 });
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('duplicate code ->', await toastText(page));
  await page.getByRole('button', { name: 'ביטול' }).click();

  // export then import modified file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא ל-Excel' }).click()]);
  const xlsxPath = `${SHOTS}/export.xlsx`; await dl.saveAs(xlsxPath);
  log('exported', dl.suggestedFilename(), fs.statSync(xlsxPath).size, 'bytes');
  // build an import CSV: change 2 existing, add 1 new, 1 bad
  const csv = '﻿קוד סעיף,שם סעיף,סוג,מחלקה,תקציב 2026,ביצוע 2026\n2-02-03-110,,,,1111000,999000\n2-02-03-120,,,,,123456\n2-02-03-777,סעיף מיובא,הוצאה,חינוך יסודי,250000,0\n2-02-03-778,שגוי,הוצאה,מחלקה שלא קיימת,1,1\n';
  fs.writeFileSync(`${SHOTS}/import.csv`, csv);
  await page.getByRole('button', { name: 'ייבוא מקובץ' }).click();
  await page.locator('.modal input[type=file]').setInputFiles(`${SHOTS}/import.csv`);
  await page.waitForSelector('.import-plan');
  await shot(page, '05-import-preview');
  log('import plan:', (await page.locator('.import-plan .kpi-value').allTextContents()).join(' | '));
  await page.getByRole('button', { name: 'אישור ועדכון' }).click();
  log('import ->', await toastText(page));
  // re-import the exported xlsx itself: should be 'no change' except nothing
  await page.getByRole('button', { name: 'ייבוא מקובץ' }).click();
  await page.locator('.modal input[type=file]').setInputFiles(xlsxPath);
  await page.waitForSelector('.import-plan');
  log('re-import own export plan:', (await page.locator('.import-plan .kpi-value').allTextContents()).join(' | '));
  await page.getByRole('button', { name: 'ביטול' }).click();

  // work plan
  await page.goto(`${BASE}/#/workplan`);
  await page.waitForSelector('table.grid tbody tr');
  await page.waitForTimeout(200);
  await shot(page, '06-workplan');
  log('tasks:', await page.locator('table.grid tbody tr').count(), '| notice:', (await page.locator('.notice').first().textContent()).slice(0, 90));
  await page.getByRole('button', { name: '+ משימה חדשה' }).click();
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('empty task validation ->', await toastText(page), '| field errors:', await page.locator('.field-error').count());
  await page.locator('.modal').getByLabel('אגף').selectOption({ label: 'אגף לשיפור פני העיר' });
  await page.locator('.modal').getByLabel('מחלקה').selectOption({ label: 'אגף לשיפור פני העיר' });
  await page.locator('.modal').getByLabel('מטרה עירונית').selectOption({ index: 2 });
  await page.locator('.modal').getByLabel('פעילות').fill('הדגמה: שדרוג גנים ציבוריים');
  await page.getByRole('button', { name: '+ משימה נוספת לאותה פעילות' }).click();
  const blocks = page.locator('.task-block');
  for (let i = 0; i < 2; i++) {
    const b = blocks.nth(i);
    await b.getByLabel('תיאור המשימה').fill(`שיפוץ גן ציבורי מספר ${i + 1}`);
    await b.getByLabel('יעד הצלחה').fill('הגן נפתח לציבור');
    await b.getByLabel('תאריך יעד').fill(i === 0 ? '2026-11-27' : '2026-12-15');
    await b.getByLabel('סעיף תקציבי').selectOption({ index: 1 });
    await b.getByLabel('אומדן עלות (₪)').fill('150000');
  }
  await shot(page, '07-task-new');
  log('weekend hint:', await blocks.nth(0).locator('.field-hint').allTextContents());
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('save 2 tasks ->', await toastText(page));
  // quarter update on a row in open quarter (Q3)
  await page.waitForTimeout(300);
  const chip = page.locator('table.grid tbody tr').first().locator('td.qcol').nth(2).locator('button');
  await chip.click();
  await page.waitForSelector('.modal');
  await page.getByRole('radio', { name: 'עיכוב' }).click();
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('delay without note ->', await toastText(page));
  await page.locator('.modal textarea').fill('ממתין לאישור תקציבי');
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('quarter update ->', await toastText(page));
  // export
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא ל-Excel' }).click()]);
  await dl2.saveAs(`${SHOTS}/workplan.xlsx`); log('workplan export', fs.statSync(`${SHOTS}/workplan.xlsx`).size, 'bytes');

  // users
  await page.goto(`${BASE}/#/users`);
  await page.waitForSelector('table.grid tbody tr');
  await page.getByRole('button', { name: '+ משתמש חדש' }).click();
  await page.locator('.modal').getByLabel('שם משתמש').fill('noa.m');
  await page.locator('.modal').getByLabel('שם מלא').fill('נועה מזרחי');
  await page.locator('.modal').getByLabel('סיסמה ראשונית').fill('Noa12345!');
  await page.locator('.modal').getByLabel('תפקיד').selectOption('dept');
  await page.locator('.modal').getByLabel('מחלקה').selectOption({ label: 'אזרחים ותיקים' });
  await page.locator('.modal').getByRole('button', { name: 'שמירה' }).click();
  log('create user ->', await toastText(page));
  await page.waitForTimeout(400);
  await shot(page, '08-users');
  log('users listed:', await page.locator('table.grid tbody tr').count(), '| audit rows:', await page.locator('.card table.mini tbody tr').count());
  await ctx.close();
}

// ---------- new dept user (just created) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`noa: ${e.message}`));
  await page.goto(BASE);
  await page.getByLabel('שם משתמש').fill('noa.m'); await page.getByLabel('סיסמה').fill('Noa12345!');
  await page.getByRole('button', { name: 'כניסה למערכת' }).click();
  await page.waitForSelector('.top-title h1');
  log('new user nav:', (await page.locator('.side nav a').allTextContents()).join(', '), '|', await page.locator('.user-meta span').textContent());
  await page.goto(`${BASE}/#/workplan`); await page.waitForSelector('.toolbar');
  log('noa sees tasks:', await page.locator('table.grid tbody tr').count());
  await ctx.close();
}

// ---------- dept user (חינוך יסודי) ----------
{
  const { ctx, page } = await session('dept');
  await page.waitForSelector('.kpi');
  await shot(page, '09-dept-dashboard');
  log('dept nav:', (await page.locator('.side nav a').allTextContents()).join(', '));
  await page.goto(`${BASE}/#/budget`); await page.waitForSelector('table.grid tbody tr');
  log('dept budget rows:', await page.locator('table.grid tbody tr').count(), '| new item btn:', await page.getByRole('button', { name: '+ סעיף חדש' }).count());
  await page.goto(`${BASE}/#/workplan`); await page.waitForSelector('table.grid tbody tr');
  log('dept tasks:', await page.locator('table.grid tbody tr').count());
  // locked quarter Q1 -> read-only message
  await page.locator('table.grid tbody tr').first().locator('td.qcol').nth(0).locator('button').click();
  log('dept Q1 dialog:', (await page.locator('.modal .notice').textContent()));
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('button', { name: '+ משימה חדשה' }).click();
  log('dept dialog: division disabled', await page.locator('.modal').getByLabel('אגף').isDisabled(), '| dept disabled', await page.locator('.modal').getByLabel('מחלקה').isDisabled());
  await page.getByRole('button', { name: 'ביטול' }).click();
  // direct URL to users page
  await page.goto(`${BASE}/#/users`); await page.waitForTimeout(400);
  log('dept on #/users shows:', await page.locator('.top-title h1').textContent());
  await ctx.close();
}

// ---------- wing + treasurer + mobile ----------
{
  const { ctx, page } = await session('wing');
  await page.goto(`${BASE}/#/workplan`); await page.waitForSelector('table.grid tbody tr');
  log('wing tasks:', await page.locator('table.grid tbody tr').count(), '| dept filter options:', await page.locator('.toolbar select[aria-label=מחלקה] option').count());
  await ctx.close();
}
{
  const { ctx, page } = await session('gizbar');
  await page.goto(`${BASE}/#/workplan`); await page.waitForSelector('table.grid tbody tr');
  log('treasurer add-task btn:', await page.getByRole('button', { name: '+ משימה חדשה' }).count(), '| edit icons:', await page.locator('button[aria-label=עריכה]').count());
  await ctx.close();
}
{
  const { ctx, page } = await session('romy', { width: 390, height: 844 });
  await page.waitForSelector('.kpi'); await page.waitForTimeout(300);
  await shot(page, '10-mobile-dashboard');
  await page.getByRole('button', { name: 'תפריט' }).click(); await page.waitForTimeout(300);
  await shot(page, '11-mobile-nav');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  log('mobile scrollWidth', sw);
  await ctx.close();
}

await browser.close();
console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
