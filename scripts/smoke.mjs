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
    await page
      .getByText('在 Mac 应用中查看实时频谱', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.spectrum-line').count(), 0);
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
    const expectInputValue = async (input, expected) => {
      const label = await input.getAttribute('aria-label');
      await page.waitForFunction(
        ({ label, expected }) =>
          [...document.querySelectorAll('input')].find(
            (el) => el.getAttribute('aria-label') === label,
          )?.value === expected,
        { label, expected },
      );
      assert.equal(await input.inputValue(), expected);
    };
    const restore = page.getByRole('button', { name: '还原', exact: true });
    assert.equal(await restore.isDisabled(), true);
    await manualGain.focus();
    await manualGain.press('Enter');
    assert.equal(await restore.isDisabled(), true);
    await manualGain.fill('3.5');
    await manualGain.press('Enter');
    assert.notEqual(
      await page.locator('.eq-curve').getAttribute('d'),
      manualPath,
    );
    await restore.click();
    await expectInputValue(manualGain, '0');
    assert.equal(await page.locator('.eq-curve').getAttribute('d'), manualPath);
    assert.equal(await restore.isDisabled(), true);
    await manualGain.fill('3.5');
    await manualGain.press('Enter');
    await page.getByRole('button', { name: '归零', exact: true }).click();
    await expectInputValue(manualGain, '0');
    await restore.click();
    await expectInputValue(manualGain, '3.5');
    const manualFrequency = page.getByRole('spinbutton', {
      name: '滤波器 1 频率',
      exact: true,
    });
    const originalFrequency = await manualFrequency.inputValue();
    await manualFrequency.fill('900');
    await manualFrequency.press('Enter');
    await page.locator('h1').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expectInputValue(manualFrequency, originalFrequency);
    await expectInputValue(manualGain, '3.5');
    await page.getByRole('button', { name: '添加滤波器', exact: true }).click();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 7);
    await restore.click();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    await page
      .getByRole('button', { name: '删除滤波器 1', exact: true })
      .click();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 5);
    await restore.click();
    assert.equal(await page.locator('.eq-table tbody tr').count(), 6);
    await expectInputValue(manualGain, '3.5');
    await page
      .getByRole('checkbox', { name: '自动保留余量', exact: true })
      .uncheck();
    const manualPreamp = page.getByRole('spinbutton', {
      name: '前级增益',
      exact: true,
    });
    const originalPreamp = await manualPreamp.inputValue();
    await manualPreamp.fill('-20');
    await manualPreamp.press('Enter');
    await restore.click();
    await expectInputValue(manualPreamp, originalPreamp);
    await restore.click();
    assert.equal(
      await page
        .getByRole('checkbox', { name: '自动保留余量', exact: true })
        .isChecked(),
      true,
    );
    await page.locator('.curve-guide summary').click();
    assert.ok(
      (await page.locator('.curve-guide').innerText()).includes(
        '图上没有耳机当前的频响',
      ),
    );
    await page.locator('.curve-guide summary').click();
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
    await restore.click();
    await page.getByRole('button', { name: '手动调音', exact: true }).waitFor();
    await expectInputValue(manualGain, '3.5');
    await page
      .getByRole('button', { name: '导入实测曲线', exact: true })
      .click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'response.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(measurementCsv),
    });
    await page.getByRole('button', { name: '实测曲线', exact: true }).waitFor();
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
    const beforeDragFrequency = await manualFrequency.inputValue();
    const beforeDragGain = await gain.inputValue();
    const firstHandle = page.locator('.band-handle circle').first();
    await firstHandle.scrollIntoViewIfNeeded();
    await firstHandle.hover();
    const handle = await firstHandle.boundingBox();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + 30, handle.y - 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(
      (value) =>
        document.querySelector('input[aria-label="滤波器 1 频率"]').value !==
        value,
      beforeDragFrequency,
    );
    assert.notEqual(await manualFrequency.inputValue(), beforeDragFrequency);
    await restore.click();
    await expectInputValue(manualFrequency, beforeDragFrequency);
    await expectInputValue(gain, beforeDragGain);
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
    await page.locator('#target-select').selectOption('harman-in-ear-2019');
    await restore.click();
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
      .first()
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
    const beforeFit = await page.evaluate(
      () => JSON.parse(localStorage.getItem('tonebench.session.v1')).bands,
    );
    await page
      .getByRole('button', { name: '自动生成 EQ', exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('.autoeq-button')?.hasAttribute('disabled'),
    );
    await restore.click();
    assert.deepEqual(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('tonebench.session.v1')).bands,
      ),
      beforeFit,
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
    const nativePage = await browser.newPage({
      viewport: { width: 1440, height: 1150 },
    });
    nativePage.on('pageerror', (error) => errors.push(error.message));
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
    const nativeGain = nativePage.getByRole('spinbutton', {
      name: '滤波器 1 增益',
      exact: true,
    });
    await nativeGain.fill('4');
    await nativeGain.press('Enter');
    await nativePage.waitForFunction(
      () =>
        window.__nativeMessages.findLast((m) => m.action === 'update')?.settings
          .bands[0].gain === 4,
    );
    await nativePage.getByRole('button', { name: '还原', exact: true }).click();
    await nativePage.waitForFunction(
      () =>
        window.__nativeMessages.findLast((m) => m.action === 'update')?.settings
          .bands[0].gain === 0,
    );
    assert.deepEqual(
      await nativePage.evaluate(
        () =>
          window.__nativeMessages.findLast((m) => m.action === 'update')
            .settings,
      ),
      start.settings,
    );
    const spectrum = {
      frequencies: Array.from(
        { length: 192 },
        (_, i) => 20 * 1000 ** ((i + 0.5) / 192),
      ),
      before: Array.from(
        { length: 192 },
        (_, i) => -85 + 60 * Math.exp(-(((i - 108) / 13) ** 2)),
      ),
      after: Array.from(
        { length: 192 },
        (_, i) => -91 + 64 * Math.exp(-(((i - 108) / 13) ** 2)),
      ),
      sampleRate: 44100,
      fftSize: 8192,
    };
    const sendSpectrum = () =>
      nativePage.evaluate(
        (detail) =>
          window.dispatchEvent(
            new CustomEvent('tonebench:spectrum', { detail }),
          ),
        spectrum,
      );
    await sendSpectrum();
    assert.equal(await nativePage.locator('.spectrum-line').count(), 2);
    assert.ok(
      (await nativePage.locator('.spectrum-readout').innerText()).includes(
        'dBFS',
      ),
    );
    await nativePage
      .getByRole('button', { name: 'EQ 前', exact: true })
      .click();
    assert.equal(await nativePage.locator('.spectrum-line.before').count(), 0);
    await nativePage
      .getByRole('button', { name: 'EQ 前', exact: true })
      .click();
    await nativePage.locator('.spectrum-panel').scrollIntoViewIfNeeded();
    await sendSpectrum();
    await nativePage
      .locator('.spectrum-panel')
      .screenshot({ path: 'test-results/spectrum-bridge.png' });
    // Invalid native data must leave the last valid frame intact.
    await nativePage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('tonebench:spectrum', { detail: { sampleRate: 1 } }),
      ),
    );
    assert.equal(await nativePage.locator('.spectrum-line').count(), 2);
    await nativePage.waitForTimeout(850);
    assert.equal(await nativePage.locator('.spectrum-line').count(), 0);
    await sendSpectrum();
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
            phase: 'stopped',
            message: '',
            outputDevice: 'Test DAC',
            sampleRate: 44100,
            clipped: 0,
          },
        }),
      ),
    );
    await nativePage.getByText('开启系统 EQ 后查看', { exact: true }).waitFor();
    assert.equal(await nativePage.locator('.spectrum-line').count(), 0);
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
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          checks: [
            'render',
            'manual tuning without measurement',
            'restore numeric edits, zeroing, keyboard shortcut, add/delete, preamp, measurement, target, full graph drag and automatic EQ',
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
            'native bridge start/update/restore/bypass/stop/error at 44.1 kHz (mocked)',
            'spectrum bridge, toggles, invalid data, stale-frame timeout and stop clearing (mocked)',
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
