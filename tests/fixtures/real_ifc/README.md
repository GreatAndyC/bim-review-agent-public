# IFC 合成回归语料

公开仓库只包含由本项目生成的确定性问题模型，不分发第三方建筑样例或带有来源方元数据的真实 IFC。

[`generated_issues/`](generated_issues/) 中的 20 个 IFC4 模型由
[`scripts/generate_issue_corpus.py`](../../../scripts/generate_issue_corpus.py) 生成，
用于覆盖缺失字段、无效值、边界值、零门模型和规则结果。每个模型都带有稳定的
GlobalId，manifest 固定其哈希和预期结果。

真实 IFC 样例、来源包和大模型回归语料保留在内部开发环境，不属于这个公开仓库。
