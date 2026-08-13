# HKU AI+BIM 演示成片 QA 报告

日期：2026-08-13
候选版本：HyperFrames 1:53 当前宽度真实界面 + MiniMax 普通话配音 + MiniMax 科技感 BGM
状态：**PASS；最终版本已重新渲染并完成音视频解码与关键帧复核。**

## 1. 验收结论

| 门禁 | 状态 | 当前证据 |
| --- | --- | --- |
| 当前产品界面 | PASS | 11 个章节均使用当前部署版浅色真实 UI；没有旧 Python 页面、旧深色报告或个人 Chrome 画面 |
| 当前宽度素材 | PASS | Codex in-app Browser 截图，调整后 `1117×762`；原始证据保留在本地交付环境，不进入公开仓库 |
| 实际操作链 | PASS | 概览 → 新建审查 → 上传模型 → 选择规则 → 开始审查 → 查看结果 → 复制/打印 → 批量上传 → 批量 PDF 导出 |
| 两条具体规则 | PASS | `IfcDoor.Name` 缺失 → REVIEW；`ClearWidth 820 mm < 850 mm` → FAIL |
| 工程判断 | PASS | `OverallWidth 900 mm` 明确标为代理值；显式净宽缺失时不自动通过 |
| 批量能力 | PASS | 真实 UI 显示 2 个文件独立完成、25 条发现，并显示“导出所选 PDF” |
| MiniMax 旁白 | PASS | 11 段 `speech-2.8-hd` 普通话旁白，全部不超过对应 frame 时长；结尾句约 3.47 秒 |
| MiniMax BGM | PASS | `music-3.0-free` 纯 instrumental，约 197.137 秒，混音音量 0.10 |
| 旧音效 | PASS | `audio_meta.json` 的 `sfx` 为 `[]`，没有旧版 flashy SFX 进入成片 |
| 字幕 | PASS | 字幕已烧录进 MP4；白字、黑描边、无外挂 SRT、无黑白底闪烁 |
| HyperFrames check | PASS | 0 lint error / 0 lint warning；Runtime 0 error；Layout 0 issue；Motion 0 error；Contrast 41/41 |
| 快照人工检查 | PASS | 13 个指定时间点 + 1 个自动尾帧快照；重点复核新建审查状态切换、批量页和结束画面 |
| 最终 MP4 | PASS | 113.000 秒、1920×1080、30 fps、H.264 + AAC；整条 `ffmpeg` 解码无错误 |

## 2. 真实流程与证据核对

当前界面展示的主要运行事实：

- 来源：`mixed_review.ifc`
- Schema：`IFC4`
- 模型规模：4 个 `IfcDoor`
- 规则包：`hk-fire-safety-2011-2024 · v1.0.0`
- 结果总览：17 findings、12 PASS、1 FAIL、4 REVIEW
- 名称规则：证据路径明确指出 `IfcDoor.Name` 缺失；不把 `GlobalId` 或描述文本猜作门名
- 宽度规则：D-11 的 `Pset_BIMReview.ClearWidth = 820 mm`，规则要求 `≥ 850 mm`，差值 `-30 mm`，结果 FAIL
- 代理值边界：`IfcDoor.OverallWidth = 900 mm` 只作为 proxy；策略为 `explicit_clear_width_only`
- 结果交接：真实结果页显示 `复制 JSON`、`复制 Markdown`、`打印 PDF`；复制 Markdown 的已复制状态被捕获
- 批量运行：`mixed_review.ifc` 与 `clean.ifc` 逐文件完成，批量摘要显示 2 个已完成文件、25 条发现、5 项需要处理，并提供 `导出所选 PDF`
- 历史交接：历史记录显示 IFC、Schema、规则包、发现数量和待处理项目，可继续打开结果

## 3. 叙事与画面检查

| 时间段 | 内容 | 核验 |
| --- | --- | --- |
| 0:00–0:09 | 说明 BIM Agent 检查门名称和出口门净宽 | 概览真实 UI 可见 |
| 0:09–0:21 | 新建审查：空页面 → 上传 `mixed_review.ifc` | 同一镜头内有真实状态交叉切换 |
| 0:21–0:31 | 选择香港消防安全预审和两条规则 | 规则选择页可见 |
| 0:31–0:41 | 点击运行，显示四阶段 Agent trace | 进行中 UI 可见 |
| 0:41–0:52 | 查看结果：17 / 12 / 1 / 4 | 结果总览可见 |
| 0:52–1:01 | 复制 JSON / Markdown、打印 PDF | 三个真实按钮可见，Markdown 已复制 |
| 1:01–1:12 | 名称缺失：REVIEW | 名称详情和字段路径可见 |
| 1:12–1:25 | D-11 净宽 FAIL | 820、850、-30 和证据面板可见 |
| 1:25–1:35 | 批量上传两个 IFC | 两个真实文件和批量说明可见 |
| 1:35–1:48 | 批量摘要、选中 PDF 导出、其他侧栏入口 | 批量结果页和“导出所选 PDF”可见 |
| 1:48–1:53 | 历史记录和结束语 | 约 3.5 秒旁白，最后画面稳定收束 |

视觉基调为白灰背景、深蓝细线、真实 UI 主画面和短右侧解释。动效只做轻微左右进入、淡入、状态交叉切换和停留，没有矩阵、霓虹、3D 模型、伪鼠标或抽象 AI 特效。

## 4. 音频检查

### 配音

- Provider：MiniMax
- Model：`speech-2.8-hd`
- Voice：`Chinese (Mandarin)_Reliable_Executive`
- Speed：`1.08`
- 每段画面时长与旁白时长：

  | Frame | 画面时长 | 旁白时长 |
  | ---: | ---: | ---: |
  | 1 | 9.00s | 5.54s |
  | 2 | 12.00s | 11.20s |
  | 3 | 10.00s | 9.00s |
  | 4 | 10.00s | 9.72s |
  | 5 | 11.00s | 10.08s |
  | 6 | 9.00s | 7.63s |
  | 7 | 11.00s | 10.15s |
  | 8 | 13.00s | 12.31s |
  | 9 | 10.00s | 9.25s |
  | 10 | 13.00s | 12.10s |
  | 11 | 5.00s | 3.47s |

旁白说完后保留界面停留，不拉伸音频、不用旧缓存补洞；HyperFrames 的 11 条 `clip_media_fit` 提示对应这种有意的短于 frame 槽位设计，不是音频截断。

### 配乐

- Provider：MiniMax
- Model：`music-3.0-free`
- 类型：instrumental
- 实测长度：197.137 秒
- Prompt 方向：bright soft plucked synth、轻钢琴、干净低存在感电子脉冲、轻微 forward motion；无 vocals、无 lyrics、无 dramatic trailer hit、无 distracting lead melody
- 项目混音：`0.10`

## 5. HyperFrames 门禁

执行命令：

```bash
npm run check
npx --yes hyperframes@0.7.107 snapshot --describe false --at 2,10.5,16,23,33,43,54,63,74,87,97,110,112
npx --yes hyperframes@0.7.107 render --skill=product-launch-video --quality high --workers 2 --output renders/video.mp4
```

检查结果：

- Lint：0 error、0 warning、13 info
- Runtime：0 error；11 条媒体槽位长度提示已人工核对
- Layout：0 issue across 9 samples
- Motion：0 error、0 warning
- Contrast：41/41 text checks pass WCAG AA
- Snapshots：13 个指定时间点，工具自动补 1 个尾帧；contact sheet 已人工检查
- Render：3390 帧，30 fps，2 workers，最终 assemble 成功

## 6. 最终媒体属性

| 属性 | 目标 | 实测 |
| --- | --- | --- |
| 文件 | 可完整解码 MP4 | PASS；`videos/bim-review-agent-promo/renders/video.mp4` |
| 时长 | `≤ 180s` | PASS；113.000 秒（1:53） |
| 分辨率 | 1920 × 1080 | PASS |
| 帧率 | 30 fps | PASS |
| 视频 | 常用播放器兼容 | PASS；H.264，约 870 kbps |
| 音频 | 旁白 + BGM | PASS；AAC，48 kHz，双声道，约 200 kbps |
| 文件大小 | — | 15,208,497 bytes（约 14.5 MB） |
| 解码 | 全片无错误 | PASS；`ffmpeg -v error -i renders/video.mp4 -f null -` 退出码 0 |
| SHA-256 | 交付收据 | `e2a38603be2c826611a57ca7cbc7ee851e8245b36fa84bf1034b0057dbb92c39` |

## 7. 隐私与声明边界

- 浏览器素材只来自 Codex in-app Browser；没有使用个人 Chrome。
- MiniMax Key 只在本地终端环境中使用，没有写入文档、manifest、源码或视频元数据。
- 截图中不包含浏览器账户状态、凭证、私有文件或其他个人隐私。
- 成片展示的是确定性预审和证据交接，不是法定认证。
- 规则参数与 demo 数据不冒充香港法规条文；专业人员仍需完成正式审查。
