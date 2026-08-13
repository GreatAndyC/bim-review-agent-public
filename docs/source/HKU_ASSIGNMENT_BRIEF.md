# HKU AI+BIM Technical Assessment — Source Brief

## Provenance

- Source: user-provided assessment text
- Archived: 2026-08-09
- Assessment received: 2026-08-06 23:00 HKT (`UTC+08:00`)
- Seven-day submission deadline: 2026-08-13 23:00 HKT (`UTC+08:00`)

This file preserves the supplied requirement as the stable source for product and implementation decisions. The local 31-page WPS/DOCX source archive is kept unchanged under `docs/source/private/` and is not distributed through Git. The original submission address is deliberately redacted from the repository and must be obtained from the private assessment message.

## Original requirement

> 同学好，感谢您对我们 HKU AI+BIM 团队职位的兴趣！这是一个简短能力测试，旨在快速了解您利用 AI 学习速度与工程品味。请在 7 天内完成。
>
> **测试任务**
>
> 在 7 天内构建一个 Web 微原型或智能 Agent，用于对建筑模型/设计进行基础合规与合理性检查（实现 1–2 条规则即可）。
>
> **提交**
>
> - 提交内容：两个链接，一个 GitHub 仓库（代码 + 提示词），一个 3 分钟以内的演示/介绍视频的链接。
> - 提交方式：按“【HKU AI Agent 笔试测试】姓名_学校/单位”的主题形式发送到 `<HKU_SUBMISSION_EMAIL_FROM_PRIVATE_BRIEF>`，并附上你的简历。
>
> **提示与建议**
>
> 1. 检查内容：请自行利用 AI 调研 BIM/CAD 模型检查、IFC 结构及规范（碰撞、消防、算量等）。只做 1–2 条规则，精炼优先。例如：几何碰撞（墙/梁/管道）、疏散门净宽度检查、房间到出口距离、模型属性完善（如名称/FireRating）等。
> 2. 数据格式：IFC 模型、CAD 模型、JSON 简化模型、AutoCAD/Revit 导出等均可。请自行调研搜集 sample、模型或用 AI 生成测试数据。
> 3. 实现形式：Web 工具、智能 Agent、本地脚本均可。技术栈完全自由（Python + IfcOpenShell、JS、LangChain/Claude Agent 等）。
> 4. 考察重点：无需追求完美，核心是“可运行 + 有思考 + 有品味”。代码结构清晰、人机交互友好实际、设计决策有判断力、结果可视化有帮助等。
> 5. 其他：我们更看重您的学习速度、工程判断力和潜力，而非已有建筑领域知识。期待您的作品！

## Normalized deliverables

| Deliverable | Definition of done |
|---|---|
| GitHub repository | Code, prompt assets, documentation, reproducible setup, test data, and a clear README |
| Web prototype / Agent | Accepts a model, runs one or two rules, presents useful evidence, and produces a repeatable result |
| Demo video | No longer than three minutes; shows the problem, one end-to-end run, evidence, and design rationale |
| Submission email | Required subject format, two links, and résumé attached |

## Interpretation decisions

- The MVP will implement exactly two checks: `INFO-001` and `EGRESS-001`.
- IFC is the primary input because it best demonstrates BIM learning while remaining vendor-neutral.
- Rule outcomes are deterministic. Natural-language AI output is optional and cannot alter a verdict.
- Missing or unreliable model data produces `REVIEW`, not an unsupported `PASS` or `FAIL`.
- The initial width threshold is a versioned demo parameter until an authoritative jurisdiction-specific clause is selected and cited.
