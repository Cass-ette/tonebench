import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

(async () => {
  await fs.mkdir('test-results', { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.TONEBENCH_BROWSER_PATH
      ? { executablePath: process.env.TONEBENCH_BROWSER_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(process.env.TONEBENCH_URL || 'http://127.0.0.1:5173/', {
      waitUntil: 'networkidle',
    });
    assert.equal(await page.locator('.curve').count(), 0);
    await page.getByText('网页编辑器', { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '开启系统 EQ', exact: true })
        .count(),
      0,
    );
    await page
      .getByRole('button', { name: '直接手动调音', exact: true })
      .click();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    assert.equal(await page.locator('.curve').count(), 2);
    assert.equal(
      await page
        .getByRole('button', { name: '自动生成 EQ', exact: true })
        .isDisabled(),
      true,
    );
    const manualPath = await page.locator('.eq-curve').getAttribute('d');
    const manualGain = page.getByRole('spinbutton', {
      name: '滤波器 1 增益',
      exact: true,
    });
    await manualGain.fill('3.5');
    await manualGain.press('Enter');
    assert.notEqual(
      await page.locator('.eq-curve').getAttribute('d'),
      manualPath,
    );
    await page.getByRole('button', { name: '导出 EQ', exact: true }).click();
    await page
      .getByRole('button', { name: 'ToneBench JSON', exact: true })
      .click();
    assert.equal(
      JSON.parse(await page.locator('.export-preview').innerText()).measurement,
      null,
    );
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page.getByRole('button', { name: '保存预设', exact: true }).click();
    await page.getByRole('textbox', { name: '预设名称' }).fill('手动调音预设');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '保存预设', exact: true })
      .click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '手动调音', exact: true }).waitFor();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    await page.getByRole('button', { name: /我的预设/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /手动调音预设/ })
      .first()
      .click();
    await page.getByRole('button', { name: '手动调音', exact: true }).waitFor();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    await page
      .locator('.heading-actions')
      .getByRole('button', {
        name: '导入实测曲线',
        exact: true,
      })
      .click();
    const measurementCsv =
      'frequency,db\n' +
      [20, 40, 100, 500, 1000, 2000, 8000, 20000]
        .map((f, i) => `${f},${80 + Math.sin(i) * 3}`)
        .join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'response.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(measurementCsv),
    });
    await page.getByRole('button', { name: '实测曲线', exact: true }).waitFor();
    assert.equal(await page.locator('.curve').count(), 3);
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    const fontInfo = await page.locator('h1').evaluate((el) => ({
      font: getComputedStyle(el).fontFamily,
      pingfang: document.fonts.check('16px "PingFang SC"'),
    }));
    const originalPath = await page
      .locator('.predicted-curve')
      .getAttribute('d');
    const gain = page.getByRole('spinbutton', {
      name: '滤波器 1 增益',
      exact: true,
    });
    await gain.fill('3.5');
    await gain.press('Enter');
    assert.notEqual(
      await page.locator('.predicted-curve').getAttribute('d'),
      originalPath,
    );
    await gain.fill('10');
    await gain.press('Escape');
    assert.equal(await gain.inputValue(), '3.5');
    await page.getByRole('button', { name: 'EQ 曲线', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'EQ 已旁路', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page.locator('.predicted-curve').getAttribute('d'),
      await page.locator('.measured-curve').getAttribute('d'),
    );
    await page.getByRole('button', { name: 'EQ 已旁路', exact: true }).click();
    await page.getByRole('button', { name: 'EQ 增益', exact: true }).click();
    assert.equal(await page.locator('.band-handle').count(), 6);
    const handle = await page
      .locator('.band-handle circle')
      .first()
      .boundingBox();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + 30, handle.y - 10, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'EQ 增益', exact: true }).click();
    await page.getByRole('button', { name: '保存预设', exact: true }).click();
    await page.getByRole('textbox', { name: '预设名称' }).fill('UI 验证预设');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '保存预设', exact: true })
      .click();
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok(
      (
        await page.evaluate(() => localStorage.getItem('tonebench.presets.v1'))
      ).includes('UI 验证预设'),
    );
    await page.getByRole('button', { name: /我的预设/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /UI 验证预设/ })
      .first()
      .click();
    await page
      .getByRole('button', { name: '导入目标曲线', exact: true })
      .click();
    const targetCsv =
      'frequency,db\n' +
      [20, 40, 100, 500, 1000, 2000, 8000, 20000]
        .map((f, i) => `${f},${82 + Math.cos(i) * 2}`)
        .join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'reference-target.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(targetCsv),
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#target-select option:checked')?.textContent ===
        'reference-target',
    );
    assert.equal(
      await page.locator('#target-select option:checked').innerText(),
      'reference-target',
    );
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.locator('#target-select option:checked').innerText(),
      'reference-target',
    );
    await page
      .getByRole('button', { name: '导入实测曲线', exact: true })
      .click();
    const csv =
      'frequency,db\n' +
      [20, 40, 100, 500, 1000, 2000, 8000, 20000]
        .map((f) => `${f},80`)
        .join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'flat-test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await page.getByRole('button', { name: '实测曲线', exact: true }).waitFor();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    const baselineOption = await page
      .locator('#measurement-select option')
      .filter({ hasText: 'response' })
      .getAttribute('value');
    await page.locator('#measurement-select').selectOption(baselineOption);
    const customOption = await page
      .locator('#measurement-select option')
      .filter({ hasText: 'flat-test' })
      .getAttribute('value');
    await page.locator('#measurement-select').selectOption(customOption);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.locator('#measurement-select').inputValue(),
      customOption,
    );
    await page
      .getByRole('button', { name: '自动生成 EQ', exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('.autoeq-button')?.hasAttribute('disabled'),
    );
    await page.getByRole('button', { name: '导出 EQ', exact: true }).click();
    assert.ok(
      (await page.locator('.export-preview').innerText()).includes('Preamp:'),
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载文件', exact: true }).click();
    const downloaded = await downloadPromise;
    assert.equal(downloaded.suggestedFilename(), 'flat-test.txt');
    await page
      .getByRole('button', { name: 'ToneBench JSON', exact: true })
      .click();
    const exported = JSON.parse(
      await page.locator('.export-preview').innerText(),
    );
    assert.equal(exported.measurement.name, 'flat-test');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page
      .getByRole('button', { name: '导入实测曲线', exact: true })
      .click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"bad":true}'),
    });
    await page.getByRole('alert').waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes('预设格式'));
    await page.locator('input[type=file]').setInputFiles({
      name: 'restore.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await page.getByRole('button', { name: '实测曲线', exact: true }).waitFor();
    await page.getByRole('button', { name: '器材档案', exact: true }).click();
    await page
      .getByRole('textbox', { name: '器材名称', exact: true })
      .fill('测试 DAC');
    await page
      .getByRole('textbox', { name: '搭配笔记', exact: true })
      .fill('USB / 低增益');
    await page.getByRole('button', { name: '添加器材', exact: true }).click();
    assert.ok(
      (await page.locator('.gear-list').innerText()).includes('测试 DAC'),
    );
    await page.keyboard.press('Escape');
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 950 });
      const size = await page
        .locator('body')
        .evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
      assert.ok(
        size.scroll <= size.client,
        `Page overflow at ${width}: ${JSON.stringify(size)}`,
      );
    }
    await page.getByRole('status').waitFor({ state: 'hidden' });
    assert.ok(
      await page
        .locator('.tuning-panel')
        .evaluate((el) => el.getBoundingClientRect().width > 300),
    );
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    await page.evaluate(() => localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    const nativePage = await browser.newPage();
    await nativePage.addInitScript(() => {
      window.__TONEBENCH_NATIVE__ = true;
      window.__nativeMessages = [];
      window.webkit = {
        messageHandlers: {
          tonebench: {
            postMessage(message) {
              window.__nativeMessages.push(message);
              if (message.action === 'ready')
                setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent('tonebench:audio', {
                        detail: {
                          phase: 'stopped',
                          message: '',
                          outputDevice: 'Test DAC',
                          sampleRate: 44100,
                          clipped: 0,
                        },
                      }),
                    ),
                  0,
                );
            },
          },
        },
      };
    });
    await nativePage.goto(
      process.env.TONEBENCH_URL || 'http://127.0.0.1:5173/',
      { waitUntil: 'networkidle' },
    );
    await nativePage
      .getByRole('button', { name: '直接手动调音', exact: true })
      .click();
    await nativePage
      .getByRole('button', { name: '开启系统 EQ', exact: true })
      .click();
    const start = await nativePage.evaluate(() =>
      window.__nativeMessages.findLast((m) => m.action === 'start'),
    );
    assert.equal(start.settings.bands.length, 6);
    assert.equal(start.settings.autoPreamp, true);
    await nativePage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('tonebench:audio', {
          detail: {
            phase: 'running',
            message: '',
            outputDevice: 'Test DAC',
            sampleRate: 44100,
            clipped: 0,
          },
        }),
      ),
    );
    await nativePage.getByText('系统 EQ · 运行中', { exact: true }).waitFor();
    await nativePage
      .getByText('对数频率 · 44.1 kHz', { exact: true })
      .waitFor();
    await nativePage
      .getByRole('button', { name: 'EQ 已启用', exact: true })
      .click();
    assert.equal(
      await nativePage.evaluate(
        () =>
          window.__nativeMessages.findLast((m) => m.action === 'update')
            .settings.bypass,
      ),
      true,
    );
    await nativePage
      .getByRole('button', { name: '停止系统 EQ', exact: true })
      .click();
    assert.equal(
      await nativePage.evaluate(() => window.__nativeMessages.at(-1).action),
      'stop',
    );
    await nativePage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('tonebench:audio', {
          detail: {
            phase: 'error',
            message: '系统音频权限未允许',
            outputDevice: 'Test DAC',
            sampleRate: 44100,
            clipped: 0,
          },
        }),
      ),
    );
    await nativePage.getByText('系统音频权限未允许', { exact: true }).waitFor();
    await nativePage
      .getByRole('button', { name: '开启系统 EQ', exact: true })
      .waitFor();
    await nativePage.close();
    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          checks: [
            'render',
            'manual tuning without measurement',
            'parameter edit',
            'escape discards input',
            'bypass',
            'graph drag',
            'save and reload',
            'measurement import and switching',
            'target import and persistence',
            'automatic EQ',
            'APO download',
            'JSON round trip',
            'invalid file rejection',
            'gear notes',
            '4 viewport sizes',
            'native bridge start/update/bypass/stop/error at 44.1 kHz (mocked)',
          ],
          fontInfo,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
