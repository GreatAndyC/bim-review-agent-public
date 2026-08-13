# 三分钟演示成片脚本

**当前交付版本：1:53（113 秒）**
**对应视频工程：** [`videos/bim-review-agent-promo/`](../../videos/bim-review-agent-promo/)
**对应 QA：** [`VIDEO_QA_REPORT_2026-08-13.md`](VIDEO_QA_REPORT_2026-08-13.md)

这份脚本是当前 HKU AI+BIM 提交视频的唯一叙事基线，已取代 2026-08-09 的 2:38 无旁白旧版本。成片使用当前部署版 React/Sites 浅色真实界面，完整走一遍“新建审查 → 上传模型 → 选择规则 → 开始审查 → 查看结果 → 复制/导出 → 批量处理”的用户流程。

## 成片约束

- 画布：1920 × 1080，30 fps；时长 113 秒，低于 3 分钟上限。
- 画面：当前部署版真实 UI 为主体；不使用旧 Python/FastAPI/Jinja 页面、旧深色报告、旧 A4 报告或个人 Chrome 画面。
- 素材来源：Codex in-app Browser 当前宽度 `1117×762` 的真实 Site 截图；不展示账户、凭证、私人文件或浏览器状态。
- 配音：MiniMax `speech-2.8-hd`，`Chinese (Mandarin)_Reliable_Executive`，语速 `1.08`。
- 配乐：MiniMax `music-3.0-free` instrumental，轻快科技感、无人声；混音音量 `0.10`。
- 字幕：白字、黑色描边，直接烧录进 MP4；没有外挂字幕文件，也没有黑底/白底闪烁。
- 工程边界：Agent 负责组织模型、规则与证据；`PASS / FAIL / REVIEW` 由确定性规则产生；这不是法定认证。

## 当前演示事实

- 输入：`mixed_review.ifc`，IFC4，4 个 `IfcDoor`。
- 规则包：`hk-fire-safety-2011-2024 · v1.0.0`。
- 单文件结果：17 条发现、12 PASS、1 FAIL、4 REVIEW。
- 名称问题：某个 `IfcDoor.Name` 缺失，结果为 `REVIEW`；`GlobalId` 只用于定位，不能替代名称。
- 宽度问题：D-11 的显式 `ClearWidth = 820 mm`，演示规则要求 `≥ 850 mm`，差值 `-30 mm`，结果为 `FAIL`。
- 证据边界：`OverallWidth = 900 mm` 只作为 proxy，不能自动当作净开口。
- 批量结果：同时选择 `mixed_review.ifc` 与 `clean.ifc`，2 个文件完成、25 条发现，并提供“导出所选 PDF”。

## 时间轴与旁白

| 时间 | 章节 | 画面必须证明的事实 | 旁白 |
|---|---|---|---|
| 0:00–0:09 | 说明检查目标 | 概览页与产品入口 | BIM Agent 用来做 IFC 建筑模型预审，今天检查门名称和出口门净宽。 |
| 0:09–0:21 | 新建审查并上传模型 | 新建审查、`mixed_review.ifc` 已选择、支持多 IFC | 进入新建审查，上传 mixed_review.ifc。页面显示文件已选择，并提示同一入口也支持一次选择多个 IFC 文件。 |
| 0:21–0:31 | 选择规则 | 香港消防安全预审与两条规则 | 下一步选择香港消防安全预审，确认两条规则：门信息证据完整性和出口门最小净宽，然后进入运行。 |
| 0:31–0:41 | 开始审查 | 点击运行后的四阶段 Agent trace | 点击运行审查。页面实时显示上传、检查模型、运行规则和组装证据四个阶段；完成后直接查看结果。 |
| 0:41–0:52 | 结果总览 | 17 / 12 / 1 / 4 的状态分流 | 结果总览先给出分流：十七条发现，十二项通过、一项失败、四项待复核。接下来打开需要处理的项目。 |
| 0:52–1:01 | 结果交接 | 复制 JSON、复制 Markdown、打印 PDF | 结果页可以复制 JSON、复制 Markdown，或打印 PDF，审查结论可以直接交给工程师继续处理。 |
| 1:01–1:12 | 名称检查 | `IfcDoor.Name` 缺失 → REVIEW | 名称检查发现，某个 IfcDoor 缺少 IfcDoor.Name，所以标记为 REVIEW。GlobalId 只用于定位，不能替代门名称。 |
| 1:12–1:25 | 净宽检查 | D-11、820、850、-30 → FAIL；proxy 边界 | 宽度检查给出确定性失败：D-11 的 ClearWidth 是八百二十毫米，要求至少八百五十，差三十毫米。OverallWidth 只能作为代理证据。 |
| 1:25–1:35 | 批量上传 | 两个 IFC 文件同时进入同一新建审查流程 | 批量处理时，一次选择多个 IFC。这里选了 mixed_review.ifc 和 clean.ifc，分别审查。 |
| 1:35–1:48 | 批量结果与其他入口 | 批量摘要、选中 PDF 导出、规则/样例/历史入口 | 批量结果页汇总每个文件的发现，勾选已完成文件，就能一次导出所选 PDF。规则配置、样例与数据、历史记录也都可以从侧栏进入。 |
| 1:48–1:53 | 收尾 | 历史交接画面稳定停留 | 以上就是 BIM Agent 网页 Demo 版本的全部内容。 |

## 关键口径

- 说“预审”“证据交接”或“demo”，不说“自动完成法定合规认证”。
- 明确 `REVIEW` 是证据不足、矛盾或 proxy-only，不是较轻的 `FAIL`。
- 不把 `OverallWidth` 改名为净宽；不把 `GlobalId` 或描述文本猜成 `IfcDoor.Name`。
- 不把 Agent trace 描述成私有思维链；只展示可以交接的动作与观察。
- `820 mm`、`≥ 850 mm` 和 `OverallWidth 900 mm` 是当前 demo 数据与规则参数，不冒充香港法规条文。
- 批量功能只承诺当前界面可见的逐文件审查、批量摘要和选中 PDF 导出。

## 复现与验收

```bash
cd videos/bim-review-agent-promo
npm run check
npx --yes hyperframes@0.7.107 snapshot --describe false --at 2,10.5,16,23,33,43,54,63,74,87,97,110,112
npx --yes hyperframes@0.7.107 render \
  --skill=product-launch-video \
  --quality high \
  --workers 2 \
  --output renders/video.mp4
```

当前验收结果：HyperFrames Lint 为 0 error / 0 warning，Runtime 为 0 error；另有 11 条已知 `clip_media_fit` 提示，原因是旁白短于画面槽位、保留界面停留，并非音频截断或渲染失败。Layout 0 issue，Motion 0 error，Contrast 41/41；最终 MP4 为 113.000 秒、1920×1080、H.264 + AAC，完整 `ffmpeg` 解码无错误。视频观看链接通过提交邮件单独提供，不写入公开仓库。
