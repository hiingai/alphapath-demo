# -*- coding: utf-8 -*-
"""差分比对：out_py.json（v1.4 原版）vs out_js.json（浏览器引擎）"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DUMPS = []


def diff(a, b, path=""):
    if isinstance(a, float) or isinstance(b, float):
        try:
            if abs(float(a) - float(b)) <= 1e-9:
                return []
        except (TypeError, ValueError):
            pass
        return [(path, a, b)]
    if type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
        return [(path, a, b)]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append((path + "/" + k, "<缺失>", b[k]))
            elif k not in b:
                out.append((path + "/" + k, a[k], "<缺失>"))
            else:
                out += diff(a[k], b[k], path + "/" + k)
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [(path, "len=%d" % len(a), "len=%d" % len(b))]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, path + "[%d]" % i)
        return out
    if a != b:
        return [(path, a, b)]
    return []


def main():
    py = json.load(open(os.path.join(HERE, "out_py.json"), encoding="utf-8"))
    js = json.load(open(os.path.join(HERE, "out_js.json"), encoding="utf-8"))
    keys = sorted(set(py) | set(js))
    bad = 0
    for k in keys:
        if k not in py or k not in js:
            print("✗ %-5s 只在一侧存在" % k)
            bad += 1
            continue
        d = diff(py[k], js[k])
        if d:
            bad += 1
            print("✗ %-5s %d 处差异" % (k, len(d)))
            for path, a, b in d[:6]:
                sa = json.dumps(a, ensure_ascii=False) if not isinstance(a, str) else a
                sb = json.dumps(b, ensure_ascii=False) if not isinstance(b, str) else b
                print("    %s\n      py: %s\n      js: %s" % (path, str(sa)[:160], str(sb)[:160]))
    print("\n合计 %d 项，差异 %d 项，一致率 %.1f%%" % (len(keys), bad, 100.0 * (len(keys) - bad) / max(1, len(keys))))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
