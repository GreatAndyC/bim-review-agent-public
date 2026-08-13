---
format: 1920x1080
duration: 113s
message: "真实界面完整走查：先解释检查目标，再走完新建审查、结果交接、批量处理和其他入口。"
arc: "检查什么 → 概览 → 新建审查 → 上传模型 → 选择规则 → 运行 → 查看结果 → 复制/导出 → 批量处理 → 其他功能 → 结束"
audience: "HKU AI+BIM technical reviewers"
mode: real-ui-walkthrough
music: "MiniMax light upbeat technology instrumental"
visual_ratio: "real product UI 95% · restrained annotations 5% · generated footage 0%"
---

## Video direction

- 画面只使用当前部署版 React/Sites 界面的真实内置浏览器截图；不使用个人 Chrome、旧 Python 页面或旧深色报告。
- 叙事先回答“这个 Agent 检查什么”，然后严格按用户操作顺序走一遍：新建审查、上传模型、选择规则、开始审查、查看结果、复制/导出。
- 每一帧以真实 UI 为主画面，右侧只保留一组短解释；不把视频做成静态报告轮播。
- 外框采用白灰底、深蓝文字和细线；不加入渐变、霓虹、3D 模型、伪造鼠标或抽象 AI 特效。
- 字幕放在底部安全区，使用简单白字黑描边；MiniMax 人声是主叙事，BGM 保持低音量，不盖住 IFC 字段和规则参数。
- 重要读数必须来自真实界面：17 / 1 / 4 / 12、IfcDoor.Name、820 mm、≥ 850 mm、-30 mm、批量 2 文件、25 条发现。

## Frame 1 — 先说明检查目标

- duration: 9s
- poster: 4.5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/01-before-site.html
- type: product-overview
- asset: assets/flow-00-overview.png
- voiceover: "BIM Agent 用来做 IFC 建筑模型预审，今天检查门名称和出口门净宽。"

概览页先建立产品定位和两个具体问题，让评审知道后面的操作会验证什么。

## Frame 2 — 新建审查并上传模型

- duration: 12s
- poster: 6s
- transition_in: crossfade
- status: real-ui
- src: compositions/frames/02-product-promise.html
- type: create-review-upload
- asset: assets/flow-02-model-uploaded.png
- voiceover: "进入新建审查，上传 mixed_review.ifc。页面显示文件已选择，并提示同一入口也支持一次选择多个 IFC 文件。"

真实界面停在模型已上传状态，明确第一步不是看报告，而是从模型输入开始。

## Frame 3 — 选择规则

- duration: 10s
- poster: 5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/03-authority-split.html
- type: rule-selection
- asset: assets/flow-03-rule-selection.png
- voiceover: "下一步选择香港消防安全预审，确认两条规则：门信息证据完整性和出口门最小净宽，然后进入运行。"

本镜头展示真实的规则选择页，不把规则描述和执行阈值混为一谈。

## Frame 4 — 点击开始审查

- duration: 10s
- poster: 5s
- transition_in: crossfade
- status: real-ui
- src: compositions/frames/04-agent-process.html
- type: agent-run
- asset: assets/flow-05-review-started.png
- voiceover: "点击运行审查。页面实时显示上传、检查模型、运行规则和组装证据四个阶段；完成后直接查看结果。"

用真实的进行中界面展示一次操作，而不是只展示已经生成的报告。

## Frame 5 — 查看结果总览

- duration: 11s
- poster: 5.5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/05-canonical-run.html
- type: findings-overview
- asset: assets/flow-07-results-overview.png
- voiceover: "结果总览先给出分流：十七条发现，十二项通过、一项失败、四项待复核。接下来打开需要处理的项目。"

把报告定位成发现工作台，先看数量和状态，再深入证据。

## Frame 6 — 复制结果或导出 PDF

- duration: 9s
- poster: 4.5s
- transition_in: crossfade
- status: real-ui
- src: compositions/frames/06-fail-proof.html
- type: result-handoff
- asset: assets/flow-08-copy-markdown.png
- voiceover: "结果页可以复制 JSON、复制 Markdown，或打印 PDF，审查结论可以直接交给工程师继续处理。"

真实按钮同时可见；复制 Markdown 的已复制状态证明交接入口确实被操作过。

## Frame 7 — 深入看名称检查

- duration: 11s
- poster: 5.5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/07-demo-boundary.html
- type: finding-name
- asset: assets/flow-09-name-missing.png
- voiceover: "名称检查发现，某个 IfcDoor 缺少 IfcDoor.Name，所以标记为 REVIEW。GlobalId 只用于定位，不能替代门名称。"

展示第一条具体问题：缺字段会被明确交给人工复核，而不是被系统猜成通过。

## Frame 8 — 深入看净宽 FAIL

- duration: 13s
- poster: 6.5s
- transition_in: crossfade
- status: real-ui
- src: compositions/frames/08-review-proof.html
- type: finding-width
- asset: assets/flow-10-width-fail.png
- voiceover: "宽度检查给出确定性失败：D-11 的 ClearWidth 是八百二十毫米，要求至少八百五十，差三十毫米。OverallWidth 只能作为代理证据。"

把对象、字段、实际值、要求值、差值和证据边界放在同一条链上。

## Frame 9 — 批量上传

- duration: 10s
- poster: 5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/09-export-handoff.html
- type: batch-upload
- asset: assets/flow-12-batch-upload.png
- voiceover: "批量处理时，一次选择多个 IFC。这里选了 mixed_review.ifc 和 clean.ifc，分别审查。"

真实批量导入界面显示两个文件和“批量导入”说明。

## Frame 10 — 批量结果与其他入口

- duration: 13s
- poster: 6.5s
- transition_in: crossfade
- status: real-ui
- src: compositions/frames/10-engineering-close.html
- type: batch-export-and-navigation
- asset: assets/flow-15-batch-summary.png
- voiceover: "批量结果页汇总每个文件的发现，勾选已完成文件，就能一次导出所选 PDF。规则配置、样例与数据、历史记录也都可以从侧栏进入。"

真实批量摘要显示两个文件完成、二十五条发现和“导出所选 PDF”按钮；右侧补出其余入口。

## Frame 11 — 明确边界并结束

- duration: 5s
- poster: 2.5s
- transition_in: cut
- status: real-ui
- src: compositions/frames/11-closing.html
- type: closing
- asset: assets/flow-11-history.png
- voiceover: "以上就是 BIM Agent 网页 Demo 版本的全部内容。"

最后保留约两秒完整结束语，画面停在历史记录，说明结果可以继续打开和交接。
