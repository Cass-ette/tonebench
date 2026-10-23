# ToneBench

A personal workbench for headphone tuning. 个人耳机调音工作台。

React + TypeScript 构建的本地浏览器工具。以频响曲线为中心，完成测量导入、参数 EQ 自动拟合与手调、前后对比、配置保存和导出。

## 运行

需要 Node.js 22.12+（或 20.19+）。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173/`。

```sh
npm run check   # 音频计算与数据解析测试 + TypeScript 检查 + 生产构建
npm run format:check # Prettier 格式检查
npx playwright install chromium # 首次浏览器测试前安装
npm run smoke # 在另一个终端启动 dev 服务后运行 Playwright 交互检查
npm run preview # 在本地查看已构建的 dist/
```

## 当前功能

- 原始测量、目标、EQ 后预测与 EQ 增益曲线叠加；20 Hz–20 kHz 对数频率轴。
- 启动时不加载虚构耳机曲线或自动 EQ；可导入 CSV / TXT / TSV 实测，也可直接手动调音。
- 内置 Harman In-Ear 2019 目标曲线，可导入其他目标曲线并保存在本机。
- 4 / 6 / 8 / 10 段自动拟合，拟合上限 8 kHz，单段提升限制可选 0 / 3 / 6 dB。
- 峰值、低架和高架滤波器，最多 12 段；数值编辑、独立开关和图上控制点拖动。
- 预测旁路、拟合偏差对比、自动前级余量或手动前级增益。
- 草稿、测量列表、个人预设、耳机与 DAC / 耳放笔记保存在当前浏览器。
- Equalizer APO / Peace 文本导出；包含测量的 JSON 预设可导出并重新导入。
- 桌面、平板与手机布局；系统中文黑体与等宽数字。

## 导入格式

耳机测量与目标曲线均使用相同格式：前两列为频率（Hz）与声压（dB），支持逗号、制表符、空格或分号分隔，可带标题及 `#`、`*`、`//` 注释。至少需要 8 个有效测量点，范围覆盖 100–8,000 Hz；仅保留 20–20,000 Hz 内的数据。文件不得超过 1 MB。

```csv
frequency,db
20,73.2
50,74.0
100,75.1
300,76.0
1000,78.2
3000,84.1
8000,80.5
20000,70.2
```

数据按频率排序、在对数频率轴上插值，并将 1 kHz 对齐到 0 dB。重复频率与无效数值会报错。左右声道目前应分别导入。公开数据库中的曲线也受测量夹具、佩戴深度和密封影响；自动 EQ 结果不等于个人耳道测量。

## 计算与适用范围

EQ 响应采用 Robert Bristow-Johnson Audio EQ Cookbook 的双二阶滤波器公式，采样率为 48 kHz。各段响应在 dB 域叠加，预测曲线为原始测量加上 EQ 响应；前级整体衰减另行显示，未加到图中。

自动拟合采用有界坐标搜索，在测量实际覆盖的 20 Hz–8 kHz 范围内，减少等对数频率加权的均方误差，并对过大增益和 Q 值作轻度惩罚。自动拟合的单段增益限制为 −12 dB 至选定提升值，Q 为 0.35–4；手动编辑允许更宽的范围。自动前级在 20 Hz–24 kHz 计算滤波器组最大提升，并额外保留 0.5 dB 余量。

内置目标为 Harman In-Ear 2019，不代表唯一正确或适合所有人的声音。曲线文件来自 [AutoEq](https://github.com/jaakkopasanen/AutoEq)，固定版本 `7ae0f56d53074872b028649617a22bbb4232feb7`，许可见 [`LICENSES/AutoEq-MIT.txt`](LICENSES/AutoEq-MIT.txt)。AutoEq 目标文件：[Harman in-ear 2019.csv](https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/targets/Harman%20in-ear%202019.csv)。

自动拟合需要耳机实测曲线和目标曲线；耳机型号名称不是必需条件。没有实测曲线时仍可手动编辑、保存和导出 EQ，但不会显示耳机响应预测，也无法自动拟合。公开数据库中的数据可按来源文件名导入。RMS 偏差只表示曲线距离，不是听感评分。

当前工具计算和编辑调音配置，**尚不播放音频、处理系统声音或提供音频 A/B 试听**。旁路仅影响图表预测，导出仍保留已启用的滤波器。APO 配置需要在相应音频软件中应用；不同处理器或采样率可能产生响应差异。

## 数据与后续方向

测量、草稿、预设和器材笔记使用浏览器 `localStorage`，不上传到服务器；更换浏览器或清理站点数据会丢失记录，请用 JSON 导出备份。导入测量列表最多保留最近 20 条。

后续方向包括更多带明确来源和使用授权的测量、左右声道对比、音频试听，以及耳机与 DAC / 耳放的规格匹配。

## 项目结构

```text
src/audio.ts           曲线、RBJ 滤波器、拟合、导入与导出
src/harmanInEar2019.ts Harman In-Ear 2019 目标曲线数据
src/audio.test.ts      核心计算和数据校验测试
src/FrequencyChart.tsx SVG 频响图与控制点交互
src/App.tsx           工作台、测量、预设与器材记录
src/styles.css        石墨灰 / 铂金灰 / 冰蓝界面及响应式布局
scripts/smoke.mjs     桌面、手机与工作流浏览器检查
```
