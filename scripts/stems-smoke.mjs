import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

await fs.mkdir('test-results', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TONEBENCH_BROWSER_PATH
    ? { executablePath: process.env.TONEBENCH_BROWSER_PATH }
    : {}),
});
try {
  const url = process.env.TONEBENCH_URL || 'http://127.0.0.1:5173/';
  const page = await browser.newPage({
    viewport: { width: 1380, height: 950 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: /声部试听/ }).click();
  await page
    .getByText('在 ToneBench Mac 应用中使用本地分离和试听。', { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '导入音频', exact: true })
      .isDisabled(),
    true,
  );
  await page.addInitScript(() => {
    window.__TONEBENCH_NATIVE__ = true;
    window.__messages = [];
    window.webkit = {
      messageHandlers: {
        tonebench: {
          postMessage(message) {
            window.__messages.push(message);
            if (message.action === 'stemsControls' && window.__stemState) {
              window.__stemState = {
                ...window.__stemState,
                stems: message.stems,
                original: message.original,
              };
              setTimeout(
                () =>
                  window.dispatchEvent(
                    new CustomEvent('tonebench:stems', {
                      detail: window.__stemState,
                    }),
                  ),
                0,
              );
            }
          },
        },
      },
    };
  });
  await page.reload();
  await page.getByRole('button', { name: '直接手动调音', exact: true }).click();
  const session = await page.evaluate(() =>
    localStorage.getItem('tonebench.session.v1'),
  );
  const updates = await page.evaluate(
    () => window.__messages.filter((m) => m.action === 'update').length,
  );
  await page.getByRole('button', { name: /声部试听/ }).click();
  const status = {
    available: true,
    phase: 'ready',
    message: '',
    progress: 1,
    fileName: '试听音频.wav',
    duration: 60,
    position: 0,
    playing: false,
    original: false,
    headroom: -8,
    stems: ['vocals', 'drums', 'bass', 'other'].map((id) => ({
      id,
      gain: 0,
      muted: false,
      solo: false,
    })),
  };
  const emit = async (value) =>
    page.evaluate((s) => {
      window.__stemState = s;
      window.dispatchEvent(new CustomEvent('tonebench:stems', { detail: s }));
    }, value);
  await emit(status);
  const solo = page.getByRole('button', { name: '独听人声', exact: true });
  await solo.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="独听人声"]')
        .getAttribute('aria-pressed') === 'true',
  );
  const gain = page.getByRole('slider', { name: '人声音量', exact: true });
  await gain.focus();
  await gain.press('ArrowLeft');
  await page.waitForFunction(
    () =>
      window.__messages.at(-1)?.stems?.find((r) => r.id === 'vocals').gain ===
      -0.5,
  );
  assert.equal(
    await page
      .getByRole('slider', { name: '鼓音量', exact: true })
      .inputValue(),
    '0',
  );
  await page.getByRole('button', { name: '原曲', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="人声音量"]').disabled,
  );
  await page.getByRole('button', { name: '分离混音', exact: true }).click();
  await page.getByRole('button', { name: '还原音量', exact: true }).click();
  await page.waitForFunction(() =>
    window.__messages
      .at(-1)
      ?.stems?.every((r) => r.gain === 0 && !r.solo && !r.muted),
  );
  await page.getByRole('button', { name: '播放声部试听', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__messages.at(-1).action),
    'stemsPlay',
  );
  await page.getByRole('slider', { name: '试听进度', exact: true }).focus();
  await page
    .getByRole('slider', { name: '试听进度', exact: true })
    .press('ArrowRight');
  assert.equal(
    await page.evaluate(() => window.__messages.at(-1).action),
    'stemsSeek',
  );
  for (const width of [1380, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/stems-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1380, height: 950 });
  await emit({
    ...status,
    phase: 'separating',
    progress: 0.5,
    message: '正在分离 · 2 / 4',
  });
  assert.equal(
    await page
      .getByRole('button', { name: '导入音频', exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__messages.at(-1).action),
    'stemsCancel',
  );
  await emit({ ...status, phase: 'error', message: '测试文件无法读取' });
  await page.getByRole('alert').getByText('测试文件无法读取').waitFor();
  await emit({ ...status, phase: 'ready', duration: NaN });
  await page.getByRole('alert').getByText('测试文件无法读取').waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('tonebench.session.v1')),
    session,
  );
  assert.equal(
    await page.evaluate(
      () => window.__messages.filter((m) => m.action === 'update').length,
    ),
    updates,
  );
  await page.getByRole('button', { name: '调音工作台', exact: true }).click();
  assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: source controls, reset, original comparison, playback/seek bridge, cancel/error, native-only import, 2 viewport sizes; headphone EQ unchanged (bridge mocked).',
  );
} finally {
  await browser.close();
}
