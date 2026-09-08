// Explicit opt-in: real providers, synthetic HTML, isolated profile, no traces.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { launchPageRoot, stopPageRoot, createSourceFixture, addComment, openAgentSettingsPage, expandSettingsAgent, chooseModifyIntent } from '../tests/e2e/electron/ai-closed-loop-helpers.mjs';
if (process.env.STEMMIO_REAL_ACCOUNT_QA !== 'authorized') throw new Error('Explicit real-account authorization required.');
const output = path.resolve('output/playwright/trusted-loop-real-accounts');
mkdirSync(output, { recursive: true });
const profile = process.env.STEMMIO_REAL_QA_PROFILE || mkdtempSync(path.join(os.tmpdir(), 'pageroot-native-e2e-real-qa-'));
const managed = path.join(os.homedir(), 'Library/Application Support/PageRoot/agents');
if (!existsSync(path.join(profile, 'agents'))) cpSync(managed, path.join(profile, 'agents'), { recursive: true });
const fixture = createSourceFixture('trusted-loop-real-accounts.html');
writeFileSync(path.join(output, 'local-session.json'), JSON.stringify({ profile, fixture }, null, 2));
const report = { startedAt: new Date().toISOString(), providers: {}, synthetic: true, mockProviders: false };
let app;
try {
  console.log("Launching isolated real-account QA");
  app = await launchPageRoot({ isolatedUserData: profile, activeSourcePath: fixture.sourcePath });
  const workingCopyPath = await addComment(app.page, fixture.sourcePath, '只把选中的列表项文字改为“可信闭环验证通过”，其余 HTML 保持不变。');
  const workingCopyBefore = readFileSync(workingCopyPath);
  app.page.on('response', async (response) => {
    if (['/agent/status', '/status'].includes(new URL(response.url()).pathname)) {
      const payload = await response.json().catch(() => null);
      const live = payload?.agentSession;
      if (live?.providerId) {
        report.providers[live.providerId] ||= {};
        report.providers[live.providerId].live = { state: live.state, phase: live.phase, agentName: live.agentName, errorCode: live.errorCode };
      }
      if (payload?.agentSession?.errorCode) {
        report.executionError = { code: payload.agentSession.errorCode, phase: payload.agentSession.phase, publicText: payload.agentSession.visibleText };
        console.log('Execution failure', JSON.stringify(report.executionError));
      }
      return;
    }
    if (new URL(response.url()).pathname !== '/agent/diagnose') return;
    const payload = await response.json().catch(() => null);
    const selection = JSON.parse(new URL(response.url()).searchParams.get('selection') || '{}');
    const diagnostic = payload?.diagnostic;
    if (diagnostic && selection.providerId) {
      report.providers[selection.providerId] ||= {};
      report.providers[selection.providerId].diagnostic = {
        readiness: diagnostic.readiness, cause: diagnostic.cause, facts: diagnostic.facts,
        diagnosticId: diagnostic.diagnosticId, failureStage: diagnostic.failureStage,
      };
    }
  });
  console.log("Synthetic project ready");
  const settings = await openAgentSettingsPage(app.page);
  await settings.locator('.settings-secondary-action').filter({ hasText: '重新检查' }).click();
  for (const id of ['codex', 'qoder']) {
    const row = settings.getByTestId(`settings-agent-row-${id}`);
    await expandSettingsAgent(settings, id);
    await expect(row).toHaveAttribute('data-expanded', 'true');
    console.log(id, 'actions', await row.getByRole('button').allTextContents());
    const check = row.locator('[data-kind="recheck"]');
    if (await check.isVisible()) await check.click();
    await expect(row.locator('.settings-agent-service-main')).not.toContainText(/未检查|正在检查/u, { timeout: 60000 });
    console.log(`Diagnosed ${id}`);
    report.providers[id] = { ...report.providers[id], summary: await row.locator('.settings-agent-service-main').innerText() };
    await row.screenshot({ path: path.join(output, `${id}-diagnosis.png`) });
  }
  await app.page.getByRole('button', { name: '返回工作台' }).click();
  if (!await app.page.getByTestId('ai-conversation-sidebar').isVisible()) await app.page.getByRole('button', { name: /AI 助手/u }).click();
  const sidebar = await chooseModifyIntent(app.page);
  await sidebar.getByTestId('ai-conversation-agent').click();
  await sidebar.getByTestId('ai-conversation-service-qoder').click();
  await sidebar.getByRole('button', { name: /交给 Qoder 修改/u }).click();
  const stop = sidebar.getByRole('button', { name: '停止', exact: true });
  await expect(stop).toBeVisible({ timeout: 60000 });
  await expect.poll(() => {
    const live = report.providers.qoder.live;
    if (live?.errorCode) throw new Error(`Qoder execution failed: ${live.errorCode}`);
    return Boolean(live?.agentName && live.state === 'running');
  }, { timeout: 60000 }).toBe(true);
  report.providers.qoder.runningBeforeStop = true;
  await stop.click();
  await expect(sidebar).toContainText(/已停止|已取消|停止本轮/u, { timeout: 60000 });
  report.providers.qoder.stopConfirmed = true;
  if (!readFileSync(fixture.sourcePath).equals(fixture.original) || !readFileSync(workingCopyPath).equals(workingCopyBefore)) {
    throw new Error('Synthetic source changed during cancellation.');
  }
  report.providers.qoder.sourceUnchanged = true;
  await sidebar.screenshot({ path: path.join(output, 'qoder-stopped.png') });
  console.log('Real Qoder stop confirmed');
  if (process.env.STEMMIO_REAL_QA_SCOPE !== 'qoder-stop') {
  await sidebar.getByTestId('ai-conversation-agent').click();
  await sidebar.getByTestId('ai-conversation-service-codex').click();
  await sidebar.getByRole('button', { name: /交给 Codex 修改/u }).click();
  await expect.poll(async () => {
    const text = await sidebar.getByTestId('ai-conversation-action-bar').innerText();
    if (text.includes('生成失败') || text.includes('生成中断')) throw new Error(`Codex execution failed: ${report.executionError?.code || 'unknown'}`);
    return text.includes('修改已准备好，尚未采用');
  }, { timeout: 240000 }).toBe(true);
  report.providers.codex.candidateReady = true;
  await sidebar.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(app.page.getByTestId('ai-review-workspace')).toBeVisible({ timeout: 60000 });
  await app.page.screenshot({ path: path.join(output, 'codex-real-review.png') });
  await sidebar.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect.poll(async () => (await app.page.evaluate(() => window.htmlAIProjects.getActiveProject()))?.sourcePath, { timeout: 60000 }).toMatch(/-V2\.html$/u);
  report.providers.codex.adopted = true;
  await expect(sidebar).toContainText('已采用本次修改。', { timeout: 15000 });
  report.status = 'qoder-stop-codex-adopted';
  } else report.status = 'qoder-running-stop-confirmed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.message || 'QA failed').replace(/(?:sk|rk)-[\w-]+/gu, '[redacted]').slice(0, 1800);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (app) await stopPageRoot(app.electronApp, profile, { cleanup: false });
}
