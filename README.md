# ToneBench

A personal workbench for headphone tuning. 个人耳机调音工作台。

耳机调音工作台，包含 Swift Mac 应用与 React + TypeScript 编辑界面。以频响曲线为中心，完成测量导入、参数 EQ 自动拟合与手调、前后对比、配置保存和导出。Mac 应用通过 Core Audio Tap 实时处理当前输出设备的系统声音，继续使用原来的音乐播放器即可。

## Mac 应用

需要 macOS 14.2+、Xcode 命令行工具和 Node.js 22.12+（或 20.19+）。

```sh
npm ci
npm run mac:build
open build/ToneBench.app
```

选择“直接手动调音”或导入实测曲线，再点击“开启系统 EQ”。首次捕获时需在 macOS 系统提示中允许录制系统音频；拒绝后请在系统设置的“隐私与安全性”中检查权限。音频仅在本机内存中处理，不保存、不上传。

- 其他应用 → 当前输出设备的 Core Audio Tap → EQ → 当前输出设备。不更改系统默认输出设备，不安装虚拟音频驱动。
- 最多 12 段参数 EQ、前级衰减、实时参数更新。切换参数时以约 20 ms 交叉淡化减少突变。
- 实时显示系统音频的 EQ 前后频谱，约每秒 20 次更新；可切换曲线、移动指针查看各频段电平。
- 旁路关闭滤波器但保留前级衰减，便于比较；停止系统 EQ 后恢复直出，音量可能与带前级衰减时不同。
- 首版支持单一双声道、32 位浮点、32–192 kHz 输出流。多通道设备、独占输出、受保护内容和蓝牙等不同设备的兼容性仍需逐项验证。
- 设备或格式变更、休眠、退出及处理异常时停止 EQ。失败时显示原因，不自动重开。
- 浏览器和 Mac 应用的本地记录独立，可用 JSON 导出与导入迁移预设。

构建产物在 `build/ToneBench.app`，仅作本机 ad-hoc 签名，**尚未使用 Developer ID 签名或经 Apple 公证**。采用 Apple 官方 API 不等于应用获得 Apple 认证。API 参考：[Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)。

```sh
npm run mac:test # 原生 DSP 与 HAL 缓冲区测试，不捕获系统音频
```

若同步目录附加的 Finder 属性导致 Swift 测试包签名失败，可将构建目录移到本机临时目录：

```sh
swift test --package-path macos --scratch-path /private/tmp/tonebench-swift-build
TONEBENCH_SWIFT_BUILD=/private/tmp/tonebench-swift-build npm run mac:build
```

开发诊断：`open -n build/ToneBench.app --args --smoke-test` 检查原生界面；`--audio-check` 会请求系统音频权限，以零增益旁路短暂检查回调，然后自动退出。结果写入 `test-results/`，不包含音频。回调正常不等于所有播放器或设备均已通过听测。

## 网页编辑器

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
- Mac 系统 EQ 与旁路；网页预测旁路；拟合偏差对比、自动前级余量或手动前级增益。
- Mac 实时频谱：20 Hz–20 kHz 对数轴、EQ 前后对比与 dBFS 读数，无音频时不显示模拟数据。
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

EQ 响应采用 Robert Bristow-Johnson Audio EQ Cookbook 的双二阶滤波器公式。Mac 应用使用设备实际采样率，网页默认 48 kHz；图表、自动拟合和原生引擎使用相同公式。各段响应在 dB 域叠加，预测曲线为原始测量加上 EQ 响应；前级整体衰减另行显示，未加到图中。

自动拟合采用有界坐标搜索，在测量实际覆盖的 20 Hz–8 kHz 范围内，减少等对数频率加权的均方误差，并对过大增益和 Q 值作轻度惩罚。自动拟合的单段增益限制为 −12 dB 至选定提升值，Q 为 0.35–4；手动编辑允许更宽的范围。自动前级在 20 Hz 至略低于奈奎斯特频率的范围计算滤波器组最大提升，并额外保留 0.5 dB 余量。输出超出数字满刻度会被限幅并显示削波提示；自动余量不保证任意信号的瞬态峰值永不削波。

内置目标为 Harman In-Ear 2019，不代表唯一正确或适合所有人的声音。曲线文件来自 [AutoEq](https://github.com/jaakkopasanen/AutoEq)，固定版本 `7ae0f56d53074872b028649617a22bbb4232feb7`，许可见 [`LICENSES/AutoEq-MIT.txt`](LICENSES/AutoEq-MIT.txt)。AutoEq 目标文件：[Harman in-ear 2019.csv](https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/targets/Harman%20in-ear%202019.csv)。

自动拟合需要耳机实测曲线和目标曲线；耳机型号名称不是必需条件。没有实测曲线时仍可手动编辑、保存和导出 EQ，但不会显示耳机响应预测，也无法自动拟合。公开数据库中的数据可按来源文件名导入。RMS 偏差只表示曲线距离，不是听感评分。

Mac 应用开启系统 EQ 后，参数和旁路会应用到当前输出设备的音频。网页只编辑和预测，不处理其他应用的声音。导出保留已启用的滤波器；APO 配置需要在相应音频软件中应用。当前未内置音乐播放器或曲库。

## 数据与后续方向

实时频谱分析实际通过系统 EQ 的数字音频，显示 dBFS，不代表耳机声压、耳机实测频响或麦克风测量。输入在前级之前采样，输出在 EQ、前级及限幅之后采样；旁路保留前级衰减，因此两条频谱仍可能有整体电平差。

分析在后台线程使用 Accelerate FFT：周期 Hann 窗，8192 / 16384 / 32768 点随设备采样率选择，窗口约 171–256 ms，刷新约 20 Hz。每个对数显示区间取 FFT 峰值；低频区间窄于 FFT 分辨率时复用最近的 FFT 点。按窗函数相干增益校准正弦峰值，左右声道平均功率，避免反相抵消；这不是每个频段的积分 RMS。图表显示 0 至 −100 dBFS，数值下限 −120 dBFS。音频回调只写预分配的无锁队列，不执行 FFT；停止、失去新音频或设备变化时清空频谱，不保存音频。网页编辑器不捕获系统音频。

测量、草稿、预设和器材笔记使用浏览器 `localStorage`，不上传到服务器；更换浏览器或清理站点数据会丢失记录，请用 JSON 导出备份。导入测量列表最多保留最近 20 条。

后续方向包括更多带明确来源和使用授权的测量、左右声道对比、本地文件试听，以及耳机与 DAC / 耳放的规格匹配。

## 项目结构

```text
src/audio.ts           曲线、RBJ 滤波器、拟合、导入与导出
src/harmanInEar2019.ts Harman In-Ear 2019 目标曲线数据
src/audio.test.ts      核心计算和数据校验测试
src/FrequencyChart.tsx SVG 频响图与控制点交互
src/SpectrumPanel.tsx 实时频谱、曲线开关与频段读数
src/spectrum.ts       频谱桥接数据校验与光标定位
src/App.tsx           工作台、测量、预设与器材记录
src/styles.css        石墨灰 / 铂金灰 / 冰蓝界面及响应式布局
scripts/smoke.mjs     桌面、手机与工作流浏览器检查
src/native.ts         Web ↔ Swift 音频状态与参数桥接
macos/                Swift / AppKit 应用与实时 C DSP
scripts/build-mac.sh  本机 Mac 应用构建与签名
```
