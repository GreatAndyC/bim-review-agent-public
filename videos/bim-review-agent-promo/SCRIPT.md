# SCRIPT — BIM Review Agent · 真实界面完整走查

**Status:** 本轮使用 MiniMax 普通话配音与 MiniMax instrumental BGM；旁白按真实操作顺序重新收紧，避免停留在旧报告或抽象介绍上。

**Voice:** MiniMax Chinese (Mandarin)_Reliable_Executive
**Voice settings:** 普通话 · speed 1.08 · 语气清晰、克制、工程化；FAIL、REVIEW、字段名和数字稍微放慢。
**Music:** 轻快但不抢话的科技感 instrumental；soft plucked synth、轻钢琴、低存在感脉冲，不要 trailer hit，不要人声。

---

## Frame 1 — 先说明检查目标（0:00–0:09）

BIM Agent 用来做 IFC 建筑模型预审，今天检查门名称和出口门净宽。

## Frame 2 — 新建审查并上传模型（0:09–0:21）

进入新建审查，上传 mixed_review.ifc。页面显示文件已选择，并提示同一入口也支持一次选择多个 IFC 文件。

## Frame 3 — 选择规则（0:21–0:31）

下一步选择香港消防安全预审，确认两条规则：门信息证据完整性和出口门最小净宽，然后进入运行。

## Frame 4 — 点击开始审查（0:31–0:41）

点击运行审查。页面实时显示上传、检查模型、运行规则和组装证据四个阶段；完成后直接查看结果。

## Frame 5 — 查看结果总览（0:41–0:52）

结果总览先给出分流：十七条发现，十二项通过、一项失败、四项待复核。接下来打开需要处理的项目。

## Frame 6 — 复制结果或导出 PDF（0:52–1:01）

结果页可以复制 JSON、复制 Markdown，或打印 PDF，审查结论可以直接交给工程师继续处理。

## Frame 7 — 深入看名称检查（1:01–1:12）

名称检查发现，某个 IfcDoor 缺少 IfcDoor.Name，所以标记为 REVIEW。GlobalId 只用于定位，不能替代门名称。

## Frame 8 — 深入看净宽 FAIL（1:12–1:25）

宽度检查给出确定性失败：D-11 的 ClearWidth 是八百二十毫米，要求至少八百五十，差三十毫米。OverallWidth 只能作为代理证据。

## Frame 9 — 批量上传（1:25–1:35）

批量处理时，一次选择多个 IFC。这里选了 mixed_review.ifc 和 clean.ifc，分别审查。

## Frame 10 — 批量结果与其他入口（1:35–1:48）

批量结果页汇总每个文件的发现，勾选已完成文件，就能一次导出所选 PDF。规则配置、样例与数据、历史记录也都可以从侧栏进入。

## Frame 11 — 明确边界并结束（1:48–1:53）

以上就是 BIM Agent 网页 Demo 版本的全部内容。
