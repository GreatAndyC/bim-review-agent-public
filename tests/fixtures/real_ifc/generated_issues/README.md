# 20 个确定性问题 IFC 模型

这里不是产品 UI 的样例目录，而是规则引擎的缺陷覆盖语料。每个模型都由 [`scripts/generate_issue_corpus.py`](../../../../scripts/generate_issue_corpus.py) 生成，使用稳定 GlobalId，且通过 IFC4 schema 校验。`manifest.json` 固定了生成文件的 SHA-256、问题类型、适用规则包、预期结果和实际结果；`cases.json` 保存生成输入的简明说明。

覆盖范围包括：

- 零门模型，用来验证“0 个发现”是明确的无适用目标，而不是审查失败或 UI 统计错误；
- `IfcDoor.Name` 缺失、内部门名称缺失；
- `Pset_DoorCommon.FireExit` 缺失、无法归一化、与门名称矛盾；
- `Pset_DoorCommon.FireRating` 缺失或为空；
- `Pset_BIMReview.ClearWidth` 缺失、只提供 `OverallWidth` 代理值、为零、为负数；
- 中国大陆 800 mm 门宽预检失败；
- 香港 Table B2 的人数缺失、非整数、超出直接机检范围，以及 30/31 人边界下各差 1 mm 的失败；
- 一个同时缺失多个证据字段的出口门。

这些模型覆盖的是当前产品已经实现的证据完整性、出口适用性和净开口宽度规则，不宣称覆盖碰撞、房间到出口距离或几何逃生路径等尚未接入的能力。

## 运行检查

```bash
PYTHONPATH=src:scripts .venv/bin/python3 scripts/generate_issue_corpus.py
PYTHONPATH=src .venv/bin/pytest -q tests/test_ifc_fixture_corpus.py
```
