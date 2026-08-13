# ADR-2026-08-12：将 React/Vinext 确定为产品主前端

## 状态

已接受（Accepted），但其中“保留 Jinja 兼容面”的部分已被
[ADR-2026-08-13](ADR-2026-08-13-retire-python-web-compat.md) 取代。本文件保留为
2026-08-12 的历史迁移记录；当前 Python 包是 CLI/reference-only。

## 背景

项目早期的本地网页工作台由 Python/FastAPI 提供 Jinja 模板、静态 JavaScript 和 CSS。它能够支撑确定性审查、报告打印和 API 演示，但页面逐渐形成了长页面堆叠的信息架构：上传、运行状态、发现项、证据和历史记录同时出现，难以建立清晰的工作流，也不适合作为招聘演示中最先被看到的产品界面。

与此同时，`apps/gpt-sites` 已经具备 React 19、TypeScript、Vinext/Vite、`web-ifc` 和现有 ReviewRun API 对接能力。继续在 Jinja 和 React 两套页面上并行增加产品交互，会造成状态、文案和规则边界重复实现。

## 决策

产品面向用户的 Web 工作台采用 **React 19 + TypeScript + Vinext/Vite** 作为唯一主前端，代码位于 `apps/gpt-sites`。

具体约束如下：

1. React 工作台负责产品交互层：导航、模型输入、运行状态、发现项筛选、证据检查、历史运行、规则说明、样例运行、导出和删除确认。
2. Python `src/bim_review_agent` 继续作为确定性审查的参考实现、CLI 和本地 FastAPI/API 兼容面。领域模型、`ReviewRun/v1`、`AgentRun`、规则包和错误语义仍是跨运行时的事实来源。
3. React 不复制 IFC 解析或规则判断。它只消费 API 返回的规范化契约，并把服务端返回的证据原样投影到界面；任何状态、阈值、观察值和推荐动作都不能在浏览器中重新推导。
4. Jinja 页面保留为兼容、打印回退和迁移期间的对照面。它不再承载新的主产品 UX；只有在 React parity、可访问性、导出/打印和浏览器验收全部通过后，才评估移除。
5. 视觉交互使用现有设计系统的冷静工程审查语言：固定应用壳层、可收起侧栏、白色证据面板、深蓝主色、青色辅助色以及 PASS/FAIL/REVIEW 语义色。禁止用总分、合规百分比、渐变、玻璃拟态或 3D 视图替代证据。
6. GSAP 仅用于受作用域管理的界面动效：进入、筛选切换和侧栏/抽屉过渡；必须通过 `useGSAP` 清理上下文，优先 transform/opacity，并尊重 `prefers-reduced-motion`。它不参与审查业务逻辑。

## 目标信息架构

```text
React App Shell
├── Sidebar：Overview / New review / Runs / Rules / Samples
├── Topbar：当前 IFC schema、运行状态、语言切换、收起按钮
└── Workspace
    ├── Setup：上传 IFC、目标说明、数据边界、规则 profile、样例入口
    ├── Running：阶段状态、进度、可解释的运行反馈
    ├── Findings：摘要、筛选、发现项索引、证据 Inspector、Agent trace
    ├── Runs：保留的运行记录和报告入口
    ├── Rules：当前规则 ID、依据、阈值和适用范围
    └── Samples：可复现 IFC fixture 与预期结果
```

桌面端工作区使用 `100dvh` 应用壳层，页面内部滚动；发现项页面采用“索引 + 证据 Inspector”双栏。窄屏端侧栏变为抽屉，双栏堆叠，不能产生横向滚动。空、运行中、成功、失败、无结果和删除后状态都必须是可见且可恢复的产品状态。

## 兼容与迁移边界

| 领域 | React 主面 | Python/Jinja 兼容面 |
|---|---|---|
| 审查执行 | 调用 API，展示 `ReviewRun/v1` | 继续执行参考 runtime |
| 发现项与证据 | React 组件和固定工作区 | 保留现有报告/打印渲染 |
| 导出与删除 | 使用已有 API，不重新计算结果 | 继续作为 API/兼容能力 |
| 规则与 IFC Schema | 服务端/共享契约 | Python 参考实现和规则包 |
| 新增主交互 | 只进入 React | 不再扩展 Jinja UX |

迁移完成的判定不是“两个页面看起来一样”，而是 React 在四个目标宽度通过无横向溢出、键盘与焦点、上传/样例/发现项/导出/打印/删除、错误与空状态验收，并通过 ReviewRun 等价性测试。

## 后果

### 正面后果

- 产品入口有明确的“Setup → Running → Findings”主线，首次打开时能快速理解下一步。
- 侧栏和证据 Inspector 使审查结果更像可操作的工程工作台，而不是一张无限增长的报告页面。
- React 组件、类型契约和 API 路由可以独立进行浏览器级验收；Python 规则引擎继续保持可复现和可测试。
- 未来增加 IFC Schema completeness、更多法规 profile 或 BCF 证据时，可沿用现有证据面板而不是再堆叠页面区块。

### 代价与风险

- 当前仓库暂时保留两套页面资源，需要明确“React 主面 / Jinja 兼容面”，避免修复遗漏。
- React 构建、浏览器响应式和可访问性成为新的发布门禁。
- `gsap` 增加了前端依赖；若动效产生性能或可访问性问题，应删除动效而不影响核心交互。

## 验收与回滚

验收命令和浏览器检查记录应写入交付说明，至少包括：

```bash
cd apps/gpt-sites
npm run typecheck
npm run lint
npm run build
npm test
```

若 React 工作台未通过 parity 门禁，回滚范围只应包含前端呈现层或将入口暂时指向兼容面；不得为了回退 UI 而复制或修改领域规则。Jinja 兼容页面在迁移完成前保留，以保证本地 CLI/FastAPI 和打印报告仍有可用入口。
