# -*- coding: utf-8 -*-
"""差分测试 · Python 侧基准：用 v1.4 原始实现跑 cases.json，输出 out_py.json。"""
import json
import os
import sys

SRC = r"D:\AI\HKagent\AlphaPath\v1.4"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SRC)

from agent.domain import legal as lg          # noqa: E402
from agent.domain import timeline as tl       # noqa: E402
from agent.domain import compliance as cp     # noqa: E402
from agent.domain import matching as mt       # noqa: E402
from agent.domain import rag as ragm          # noqa: E402
from agent import guardrails as gr            # noqa: E402
from agent import tools as tools_mod          # noqa: E402
from agent import harness as hz               # noqa: E402
from agent.conductor import Conductor         # noqa: E402


def main():
    cases = json.load(open(os.path.join(HERE, "cases.json"), encoding="utf-8"))
    out = {}

    for c in cases["timeline"]:
        try:
            out[c["id"]] = tl.compute_visa_timeline(c["identityType"], c["activationDate"])
        except Exception as e:
            out[c["id"]] = {"error": type(e).__name__ + ": " + str(e)}

    for c in cases["dwell"]:
        try:
            out[c["id"]] = tl.compute_dwell(c["segments"], c.get("asOf"))
        except Exception as e:
            out[c["id"]] = {"error": type(e).__name__ + ": " + str(e)}

    for c in cases["legal"]:
        out[c["id"]] = lg.legal_profile_of({"identityType": c["identityType"], "segments": c.get("segments") or []})

    for c in cases["compliance"]:
        out[c["id"]] = cp.check_compliance(c["input"])

    for c in cases["coupling"]:
        q = c["q"]
        items = list(tools_mod.COUPLING_RULES.items()) if hasattr(tools_mod, "COUPLING_RULES") else None
        from agent.domain.kb import COUPLING_RULES
        items = list(COUPLING_RULES.items())
        if q and q.lower() not in ("all", "全部"):
            items = [(k, v) for k, v in items if k.lower() == q.lower() or q in v]
        out[c["id"]] = [k for k, _ in items]

    for c in cases["schools"]:
        out[c["id"]] = mt.match_schools(c.get("q") or {})[:8]

    for c in cases["rag"]:
        out[c["id"]] = [d.id for d in ragm.RAGIndex().search(c["q"], 5)]

    for c in cases["calculator"]:
        out[c["id"]] = tools_mod.calculator(c["expr"])

    conductor = Conductor()
    reg = tools_mod.ToolRegistry(None, conductor)
    for c in cases["tools"]:
        v = reg.call(c["name"], c["arg"])
        if c["id"] == "t23":            # get_time 是易变项
            v = "<time>"
        if c["id"].startswith("t21") or c["id"].startswith("t22"):
            v = v.split("JOB-")[0]       # job id 随机，去掉尾部
        out[c["id"]] = v

    for c in cases["guard"]:
        out[c["id"]] = gr.guard_output(c["text"], c.get("tier"))

    # 规则路由：直接调 Agent._route（不触发 LLM）
    agent = hz.Agent.__new__(hz.Agent)
    for c in cases["route"]:
        out[c["id"]] = hz.Agent._route(agent, c["text"]) if hasattr(hz.Agent, "_route") else None

    json.dump(out, open(os.path.join(HERE, "out_py.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1, sort_keys=True)
    print("out_py.json 写出，共", len(out), "项")


if __name__ == "__main__":
    main()
