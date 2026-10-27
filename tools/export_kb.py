# -*- coding: utf-8 -*-
"""M0 · 数据导出：把 v1.4 的 Python 知识底座机械导出为浏览器端 JSON（单一数据源，不手抄）。

用法：
    python tools/export_kb.py [--src D:\\AI\\HKagent\\AlphaPath\\v1.4] [--out engine/data/kb.json]

设计原则：
- 只读 v1.4 源码，不修改；
- 原样 dump 所有数据表（键名用 JS 侧习惯的 camelCase，值不变）；
- 附带 sha256 与条目计数，供前端"数据版本"展示与 CI 校验。
"""
import argparse
import datetime
import hashlib
import json
import os
import sys

DEFAULT_SRC = r"D:\AI\HKagent\AlphaPath\v1.4"

TABLES = [
    # (输出键, kb 变量名)
    ("identityTypes", "IDENTITY_TYPES"),
    ("legalBlockRules", "LEGAL_BLOCK_RULES"),
    ("legalDwellRules", "LEGAL_DWELL_RULES"),
    ("legalCondRules", "LEGAL_COND_RULES"),
    ("dwellEffects", "DWELL_EFFECTS"),
    ("remedyActions", "REMEDY_ACTIONS"),
    ("couplingRules", "COUPLING_RULES"),
    ("educationOutcomes", "EDUCATION_OUTCOMES"),
    ("curricula", "CURRICULA"),
    ("educationStages", "EDUCATION_STAGES"),
    ("schools", "SCHOOLS"),
    ("policies", "POLICIES"),
    ("ruleCapacity", "RULE_CAPACITY"),
    ("complianceRedlines", "COMPLIANCE_REDLINES"),
    ("services", "SERVICES"),
]


def _load(src):
    if src not in sys.path:
        sys.path.insert(0, src)
    from agent.domain import kb as kb_mod          # noqa: E402
    from agent.domain import rag as rag_mod        # noqa: E402  （取 FAQ 与 RULE_VERSION）
    return kb_mod, rag_mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=os.path.join("engine", "data", "kb.json"))
    args = ap.parse_args()

    kb, rag = _load(args.src)

    payload = {"meta": {
        "source": "AlphaPath v1.4 agent/domain/kb.py",
        "ruleVersion": getattr(rag, "RULE_VERSION", ""),
        "exportedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "generator": "tools/export_kb.py",
    }}
    counts = {}
    for out_key, var in TABLES:
        if not hasattr(kb, var):
            raise SystemExit("缺少数据表：" + var)
        payload[out_key] = getattr(kb, var)
        val = payload[out_key]
        counts[out_key] = len(val) if isinstance(val, (dict, list)) else 1

    # FAQ 来自 rag.py（RAG 语料的一部分；其余语料在 JS 侧由 kb 表派生，与 rag._build_corpus 一一对应）
    payload["faq"] = [dict(id=f["id"], q=f["q"], a=f["a"]) for f in rag.FAQ]
    counts["faq"] = len(payload["faq"])

    # 语料总量自校验：应等于 rag._build_corpus 的文档数
    expected_corpus = (len(payload["policies"]) + len(payload["legalBlockRules"])
                       + len(payload["legalDwellRules"]) + len(payload["legalCondRules"])
                       + len(payload["complianceRedlines"]) + len(payload["couplingRules"])
                       + len(payload["identityTypes"]) + len(payload["schools"])
                       + len(payload["faq"]))
    payload["meta"]["corpusDocs"] = expected_corpus

    body = json.dumps(payload, ensure_ascii=False, sort_keys=False, indent=1)
    payload_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    payload["meta"]["sha256"] = payload_sha
    body = json.dumps(payload, ensure_ascii=False, sort_keys=False, indent=1)

    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)

    # 浏览器端副本：普通 <script> 即可加载（file:// 双击也能跑，无需 fetch / CORS）
    js_out = os.path.join(os.path.dirname(out), "kb.js")
    with open(js_out, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 自动生成，请勿手改：python tools/export_kb.py (源: AlphaPath v1.4 agent/domain/kb.py) */\n")
        f.write("(function(g){ g.AP_KB = " + body + "; })(typeof window!=='undefined'?window:globalThis);\n")

    print("导出完成：", out)
    print("  规则版本：", payload["meta"]["ruleVersion"])
    print("  语料条数：", expected_corpus)
    for k, v in counts.items():
        print("   - %-20s %d" % (k, v))
    print("  sha256：", payload_sha[:16] + "…")


if __name__ == "__main__":
    main()
