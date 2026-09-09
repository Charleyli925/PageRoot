// Opt-in local acceptance. User HTML and artifacts never belong in Git/CI.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, launchPageRoot, waitForProjectReady, stopPageRoot, managedWorkingCopyPath, keyShortcut } from './electron-native-harness.mjs';
import { readPublishedWorkingCopy } from './helpers/working-copy-publication.mjs';

const corpus = process.env.PAGEROOT_REAL_HTML_DIR;
if (!corpus) throw new Error('Set PAGEROOT_REAL_HTML_DIR to the user-designated local HTML corpus. Synthetic fallback is not acceptance.');
const files = readdirSync(corpus).filter(name => /\.html?$/i.test(name)).sort();
if (!files.length) throw new Error('The local corpus contains no HTML files. Acceptance was not run.');
const reportDir = mkdtempSync(path.join(tmpdir(), 'stemmio-real-html-acceptance-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diffSha256: hash(execFileSync('git', ['diff', 'HEAD', '--binary'])),
  planned: files.length, results: [],
};
console.log(`Private report: ${reportDir}`);
const saveReport = () => writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(report, null, 2));
for (const [index, filename] of files.entries()) {
  const originalPath = path.join(corpus, filename);
  const original = readFileSync(originalPath);
  const copyDir = path.join(reportDir, String(index));
  mkdirSync(copyDir);
  const copy = path.join(copyDir, filename);
  writeFileSync(copy, original);
  const row = { filename, originalSha256: hash(original), steps: [], status: 'failed' };
  let session;
  try {
    session = await launchPageRoot({ activeSourcePath: copy });
    const page = session.page;
    await waitForProjectReady(page);
    const editor = page.getByTestId('html-canvas-editor').filter({ visible: true });
    // Never keep a raw Frame across Active/Candidate handoffs.
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const id = await frame.locator('p,h1,h2,h3,li').evaluateAll(nodes => nodes.find(n => {
      const r = n.getBoundingClientRect();
      const display = n.ownerDocument.defaultView.getComputedStyle(n).display;
      // Range wrappers intentionally cannot change a flex/grid text layout.
      // Exercise formatting on a representative ordinary text host instead.
      return !/flex|grid/.test(display) && r.width > 80 && r.height > 15 && n.textContent.trim().length > 18 && !n.closest('nav,button,[role="tablist"]');
    })?.getAttribute('data-pageroot-id'));
    if (!id) throw new Error('No representative visible text host was found; this file needs an explicit scenario.');
    const target = () => frame.locator(`[data-pageroot-id="${id}"]`);
    const working = await managedWorkingCopyPath(page, copy);
    for (let round = 0; round < 2; round++) {
      await target().dblclick({ position: { x: 18, y: 10 } });
      await expect(target()).toHaveAttribute('contenteditable', 'true');
      await page.keyboard.press('ArrowLeft');
      for (let n = 0; n < 6; n++) await page.keyboard.press('Shift+ArrowRight');
      for (const name of ['加粗', '斜体', '下划线']) {
        await editor.getByRole('button', { name, exact: true }).click();
        await expect(target()).toHaveAttribute('contenteditable', 'true');
        row.steps.push(`${round}:${name}`);
      }
      await target().press(keyShortcut('ArrowRight'));
      const marker = ` QA${index}R${round}`;
      await page.keyboard.insertText(marker);
      await page.keyboard.press(keyShortcut('s'));
      await expect.poll(() => readPublishedWorkingCopy(working)).toContain(marker.trim());
      row.steps.push(`${round}:input-save`);
      await page.keyboard.press(keyShortcut('z'));
      await expect.poll(() => readPublishedWorkingCopy(working)).not.toContain(marker.trim());
      await page.keyboard.press(keyShortcut('Shift+z'));
      await expect.poll(() => readPublishedWorkingCopy(working)).toContain(marker.trim());
      row.steps.push(`${round}:undo-redo`);
      await page.keyboard.press('Escape');
      await target().dblclick({ position: { x: 18, y: 10 } });
      await expect(target()).toHaveAttribute('contenteditable', 'true');
      await page.keyboard.press('Escape');
      row.steps.push(`${round}:reenter`);
    }
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await target().dblclick({ position: { x: 18, y: 10 } });
    await expect(target()).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('Escape');
    row.steps.push('preview-edit');
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '重新载入当前 HTML', exact: true }).click();
    await expect(page.locator('.workbench-chrome-status')).toHaveText('页面已重新加载，可以继续编辑');
    await target().dblclick({ position: { x: 18, y: 10 } });
    await expect(target()).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('Escape');
    row.steps.push('reload-reenter');
    await page.screenshot({ path: path.join(copyDir, 'accepted.png') });
    // Reopen the actual managed project/profile, not a fresh import of its bytes.
    const userData = session.isolatedUserData;
    await stopPageRoot(session.electronApp, userData, { cleanup: false });
    session = await launchPageRoot({ isolatedUserData: userData });
    await waitForProjectReady(session.page);
    const reopened = session.page.getByTestId('html-canvas-editor').filter({ visible: true }).frameLocator('iframe[data-runtime-slot-role="active"]');
    const reopenedTarget = reopened.locator(`[data-pageroot-id="${id}"]`);
    await expect(reopenedTarget).toContainText(`QA${index}R1`);
    await reopenedTarget.dblclick({ position: { x: 18, y: 10 } });
    await expect(reopenedTarget).toHaveAttribute('contenteditable', 'true');
    row.steps.push('reopen-managed-project');
    row.status = 'passed';
  } catch (cause) {
    row.error = String(cause?.stack || cause);
    if (session) await session.page.screenshot({ path: path.join(copyDir, 'failure.png') }).catch(() => {});
  } finally {
    if (session) await stopPageRoot(session.electronApp, session.isolatedUserData);
    row.originalUnchanged = hash(readFileSync(originalPath)) === row.originalSha256;
    if (!row.originalUnchanged) row.status = 'failed';
    report.results.push(row);
    saveReport();
    console.log(`${index + 1}/${files.length}: ${row.status} ${filename} (${row.steps.length} steps)`);
  }
}
report.passed = report.results.filter(row => row.status === 'passed').length;
report.failed = report.results.length - report.passed;
report.skipped = 0;
saveReport();
process.exitCode = report.failed ? 1 : 0;
