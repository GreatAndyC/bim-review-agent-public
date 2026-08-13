# BIM Review Agent · 1:53 recruitment walkthrough

这是 HKU AI+BIM 能力测试的当前视频工程源文件。成片使用当前部署版的浅色真实界面，按真实用户操作顺序走完一次 IFC 预审：先说明检查什么，再点击新建审查、上传模型、选择规则、开始审查、查看结果、复制 JSON/Markdown、打印 PDF，最后补充批量上传、批量导出和其他工作区入口。

本轮不使用旧 Python 版本、旧深色报告、旧版 A4 报告素材或个人 Chrome 画面。画面中的产品 UI 来自 Codex in-app Browser 的当前部署站点；右侧只做克制的章节解释，避免把视频变成花哨的抽象动画。

## 当前交付基线

- 时长：113 秒（1:53，低于 3 分钟要求）
- 画布：1920 × 1080，30 fps
- 画面：11 个真实 UI walkthrough 章节
- 当前部署：`https://bim-review-agent.andycaoyy6.chatgpt.site/#view=overview`
- 当前样例：`mixed_review.ifc`，IFC4，4 个 `IfcDoor`
- 当前规则包：`hk-fire-safety-2011-2024 · v1.0.0`
- 结果事实：17 条发现、12 PASS、1 FAIL、4 REVIEW
- 两个问题：`IfcDoor.Name` 缺失；`Pset_BIMReview.ClearWidth = 820 mm`，低于 `≥ 850 mm`
- 批量事实：一次选择 `mixed_review.ifc` 和 `clean.ifc`，批量结果显示 2 个文件完成、25 条发现，并提供“导出所选 PDF”
- 工程边界：`OverallWidth = 900 mm` 只作为代理值，不能替代显式净开口；证据不足保留 `REVIEW`
- 生成式视频：0%；程序化内容只用于章节标题、短解释和字幕，不重绘产品界面

## 叙事结构

1. 概览：BIM Agent 检查门名称和出口门净宽。
2. 新建审查：同一镜头先展示空页面，再展示上传 `mixed_review.ifc`。
3. 选择规则：香港消防安全预审、门信息证据完整性、出口门最小净宽。
4. 开始审查：显示上传已验证、检查模型、运行规则、组装证据四个阶段。
5. 查看结果：17 / 12 / 1 / 4 的结果分流。
6. 复制/打印：复制 JSON、复制 Markdown、打印 PDF。
7. 深入问题：名称缺失 `REVIEW` 与净宽 `FAIL`。
8. 批量能力：多 IFC 上传、逐文件完成、选中批量 PDF 导出。
9. 其他入口与结尾：规则配置、样例与数据、历史记录；最后约两秒保留“以上就是 BIM Agent 网页 Demo 版本的全部内容”。

## 音频

本轮已经接入 MiniMax 音频，不是旧的无声基线：

- 配音：`speech-2.8-hd`
- 声音：`Chinese (Mandarin)_Reliable_Executive`
- 语速：`1.08`
- 配乐：`music-3.0-free`，纯 instrumental，轻快但克制的科技感；soft plucked synth、轻钢琴、低存在感电子脉冲，无人声、无歌词、无 trailer hit
- BGM 混音：`0.10`，压在普通话旁白下方
- 旧 SFX：`0`；`audio_meta.json` 中明确使用空 SFX 列表
- 字幕：烧录进 MP4，白字黑描边；没有外挂 SRT，也没有黑底/白底闪烁

API Key 只从当前终端的 `MINIMAX_API_KEY` 环境变量读取，不写入仓库、命令参数、manifest 或视频元数据。生成的 MP3 位于 `assets/audio/minimax/`，按项目规则忽略；音频生成过程与提示词由 `scripts/minimax-audio.mjs` 保留为可复现源代码。

## 源文件地图

- `BRIEF.md`：目标、证据比例、叙事判断和安全边界。
- `STORYBOARD.md`：113 秒、11 章节的画面和旁白分镜。
- `SCRIPT.md`：与 MiniMax 配音和字幕一致的中文旁白文案。
- `subtitle_meta.json`：按 frame 切分的字幕 cue 与 MiniMax 生成文本。
- `caption_groups.json`：字幕绝对时间轴。
- `audio_meta.json`：MiniMax 配音、BGM 路径与 provider metadata；SFX 为空。
- `scripts/minimax-audio.mjs`：环境变量认证的 MiniMax TTS + instrumental BGM 生成器。
- `assets/flow-*.png`：当前宽度、内置浏览器、真实 UI 操作流截图；原始抓取过程不进入公开仓库。
- 原始截图来源、浏览器边界和运行证据保留在本地交付环境，不作为公开仓库输入。
- `compositions/frames/`：11 个 seek-safe 章节画面。
- `compositions/captions.html`：字幕 sub-composition。
- `index.html`：由 storyboard、frame 文件和 audio manifest 组装出的 standalone composition。
- `renders/video.mp4`：本机当前高质量渲染结果。
- `docs/demo/VIDEO_QA_REPORT_2026-08-13.md`：本轮媒体、快照和渲染 QA 收据。

## 环境要求

- Node.js
- `npx`
- `ffmpeg` 与 `ffprobe`
- pinned HyperFrames CLI：`hyperframes@0.7.107`
- 只有重新生成 MiniMax 音频时才需要调用 MiniMax API；普通 check、snapshot、render 不需要 API Key

## 重新生成音频

从仓库根目录进入本目录执行。不要把 Key 写进文件，也不要把它放进 shell history 或命令参数：

```bash
export MINIMAX_API_KEY='只注入当前终端'
export MINIMAX_API_HOST='https://api.minimaxi.com'
npm run audio:minimax -- --dry-run
npm run audio:minimax -- --voice-only --force
export PRODUCT_LAUNCH_VIDEO_SKILL=/path/to/product-launch-video
node "$PRODUCT_LAUNCH_VIDEO_SKILL/scripts/captions.mjs" build \
  --storyboard ./STORYBOARD.md \
  --audio-meta ./subtitle_meta.json \
  --hyperframes . \
  --out ./caption_groups.json
node "$PRODUCT_LAUNCH_VIDEO_SKILL/scripts/assemble-index.mjs" \
  --storyboard ./STORYBOARD.md \
  --hyperframes .
```

默认配置就是本轮交付配置：`speech-2.8-hd`、`Chinese (Mandarin)_Reliable_Executive`、语速 `1.08`、`music-3.0-free`。如需实验，使用 `MINIMAX_TTS_MODEL`、`MINIMAX_MUSIC_MODEL`、`MINIMAX_VOICE_ID` 或 `MINIMAX_VOICE_SPEED` 环境变量覆盖，不要修改仓库内的密钥策略。

## 检查、快照和渲染

```bash
npm run check

npx --yes hyperframes@0.7.107 snapshot \
  --describe false \
  --at 2,10.5,16,23,33,43,54,63,74,87,97,110,112

npx --yes hyperframes@0.7.107 render \
  --skill=product-launch-video \
  --quality high \
  --workers 2 \
  --output renders/video.mp4
```

交付前检查：

```bash
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate,bit_rate \
  -of json renders/video.mp4

ffmpeg -v error -i renders/video.mp4 -f null -
```

当前实测：113.000 秒、1920 × 1080、H.264、AAC 48 kHz stereo，完整 `ffmpeg` 解码无错误。最终视频 SHA-256 为 `e2a38603be2c826611a57ca7cbc7ee851e8245b36fa84bf1034b0057dbb92c39`。

## 设计与声明边界

- 这是一条确定性预审与证据交接演示，不是法定认证。
- Agent 负责串联模型、规则和证据；PASS / FAIL / REVIEW 由确定性规则执行拥有。
- `820 mm`、`≥ 850 mm`、`OverallWidth 900 mm` 是当前 demo 数据和规则配置中的工程参数，不在视频中冒充香港法定条文。
- 不把 `GlobalId` 或描述文本猜成 `IfcDoor.Name`。
- 不把 `OverallWidth` 自动当成净开口；显式字段缺失时保留 `REVIEW`。
- 批量展示只承诺当前界面实际提供的逐文件审查、批量摘要和选中 PDF 导出。
- 公共 Agent trace 只展示可交接的动作与观察，不展示私有思维链。
