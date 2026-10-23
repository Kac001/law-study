"""进度合并：多设备冲突时按字段合并，避免互相覆盖。"""
import json
from typing import Any


def _as_dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}

def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default

def merge_read(a: dict, b: dict, cutoff: int = 0) -> dict:
    """已读小节取并集，保留较早的首次完成时间。

    cutoff > 0 时丢弃 cutoff 之前打的标记：用于“清理全部已掌握/重置进度”
    这类删除操作，否则并集语义会让删除永远复活。
    """
    out = dict(a)
    for sid, ts in _as_dict(b).items():
        if sid not in out:
            out[sid] = ts
        else:
            try:
                out[sid] = min(int(out[sid]), int(ts))
            except (TypeError, ValueError):
                out[sid] = out[sid]
    if cutoff:
        out = {sid: ts for sid, ts in out.items() if _int(ts) >= cutoff}
    return out


def merge_quiz(a: dict, b: dict) -> dict:
    """章内自测取较高分；同分取较晚记录。"""
    out = dict(a)
    for ch, rec in _as_dict(b).items():
        rec = _as_dict(rec)
        cur = _as_dict(out.get(ch))
        if not cur:
            out[ch] = rec
            continue
        cur_best = int(cur.get("best") or 0)
        new_best = int(rec.get("best") or 0)
        if new_best > cur_best or (new_best == cur_best and int(rec.get("at") or 0) > int(cur.get("at") or 0)):
            out[ch] = rec
    return out


def merge_qstats(a: dict, b: dict) -> dict:
    """逐题累计：对错次数取较大值，时间取较晚。"""
    out = dict(a)
    for qid, rec in _as_dict(b).items():
        rec = _as_dict(rec)
        cur = _as_dict(out.get(qid))
        if not cur:
            out[qid] = rec
            continue
        out[qid] = {
            "r": max(int(cur.get("r") or 0), int(rec.get("r") or 0)),
            "w": max(int(cur.get("w") or 0), int(rec.get("w") or 0)),
            "last": max(int(cur.get("last") or 0), int(rec.get("last") or 0)),
        }
    return out


def merge_wrong(a: dict, b: dict) -> dict:
    """错题本取并集；同一题保留错误次数较多的一条。"""
    out = dict(a)
    for qid, rec in _as_dict(b).items():
        rec = _as_dict(rec)
        cur = _as_dict(out.get(qid))
        if not cur:
            out[qid] = rec
            continue
        out[qid] = {
            "n": max(int(cur.get("n") or 0), int(rec.get("n") or 0)),
            "ok": min(int(cur.get("ok") or 0), int(rec.get("ok") or 0)),
            "ts": max(int(cur.get("ts") or 0), int(rec.get("ts") or 0)),
        }
    return out


def merge_history(a: list, b: list, limit: int = 50) -> list:
    """刷题历史按时间倒序合并去重。"""
    seen = {}
    for item in (a or []) + (b or []):
        if not isinstance(item, dict):
            continue
        key = (item.get("ts"), item.get("label"), item.get("total"), item.get("right"))
        if key not in seen:
            seen[key] = item
    return sorted(seen.values(), key=lambda x: int(x.get("ts") or 0), reverse=True)[:limit]


def merge_progress(server: dict, client: dict) -> dict:
    """阅读/自测进度合并。

    删除语义（墓碑字段，均为 epoch 毫秒）：
      readClearedAt —— 「清理全部已掌握」，只丢弃该时刻前的已读标记
      wipedAt       —— 「重置本课程进度」，丢弃该时刻前的已读与自测记录
    并集仍用于“多设备同时新增”，不会互相覆盖。
    """
    server = _as_dict(server)
    client = _as_dict(client)
    out = dict(server)
    out["version"] = 1

    s_up = int(server.get("updatedAt") or 0)
    c_up = int(client.get("updatedAt") or 0)
    s_wiped = int(server.get("wipedAt") or 0)
    c_wiped = int(client.get("wipedAt") or 0)
    wiped = max(s_wiped, c_wiped)
    cleared = max(int(server.get("readClearedAt") or 0), int(client.get("readClearedAt") or 0))
    cutoff = max(wiped, cleared)
    out["wipedAt"] = wiped
    out["readClearedAt"] = cleared

    out["read"] = merge_read(server.get("read") or {}, client.get("read") or {}, cutoff)
    quiz = merge_quiz(server.get("quiz") or {}, client.get("quiz") or {})
    if wiped:
        # 重置前的自测记录不再保留；重置后重新作答的记录（at >= wipedAt）照常合并
        quiz = {ch: rec for ch, rec in quiz.items() if _int(rec.get("at")) >= wiped}
    out["quiz"] = quiz
    # lastSid 取“更新时间较新”的一侧，不能固定让服务端优先
    s_last = server.get("lastSid") or ""
    c_last = client.get("lastSid") or ""
    # 重置是“位置也归零”的操作：重置发生在对方任何更新之后时，以重置方为准（可为空）
    if c_wiped and c_wiped >= s_up and c_wiped >= s_wiped:
        out["lastSid"] = c_last
    elif s_wiped and s_wiped >= c_up and s_wiped >= c_wiped:
        out["lastSid"] = s_last
    elif c_last and (not s_last or c_up >= s_up):
        out["lastSid"] = c_last
    elif s_last:
        out["lastSid"] = s_last
    else:
        out["lastSid"] = c_last
    out["contentVersion"] = server.get("contentVersion") or client.get("contentVersion") or ""
    out["updatedAt"] = max(s_up, c_up, wiped, cleared)
    return out


def merge_drill(server: dict, client: dict) -> dict:
    """刷题进度合并。进行中的 session 不合并，避免跨设备续做错题。"""
    server = _as_dict(server)
    client = _as_dict(client)
    out = dict(server)
    out["version"] = 1
    s_up = _int(server.get("updatedAt"))
    c_up = _int(client.get("updatedAt"))
    s_wiped = _int(server.get("wipedAt"))
    c_wiped = _int(client.get("wipedAt"))
    wiped = max(s_wiped, c_wiped)
    out["wipedAt"] = wiped
    if c_wiped and c_wiped >= s_up and c_wiped >= s_wiped:
        # 客户端重置晚于服务端任何更新：整体以客户端为准
        out = dict(client)
        out["version"] = 1
        out["wipedAt"] = c_wiped
    elif s_wiped and s_wiped >= c_up and s_wiped >= c_wiped:
        out = dict(server)
        out["version"] = 1
        out["wipedAt"] = s_wiped
    else:
        out["qstats"] = merge_qstats(server.get("qstats") or {}, client.get("qstats") or {})
        out["wrong"] = merge_wrong(server.get("wrong") or {}, client.get("wrong") or {})
        out["history"] = merge_history(server.get("history") or [], client.get("history") or [])
        if wiped:
            # 重置前的刷题记录丢弃（qstats.last / wrong.ts / history.ts 均为时间戳）
            out["qstats"] = {k: v for k, v in out["qstats"].items() if _int(v.get("last")) >= wiped}
            out["wrong"] = {k: v for k, v in out["wrong"].items() if _int(v.get("ts")) >= wiped}
            out["history"] = [h for h in out["history"] if _int(h.get("ts")) >= wiped]
    # session 是设备本地的续做状态，不跨设备合并
    out["session"] = None
    out["updatedAt"] = max(s_up, c_up, wiped)
    return out


def dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def loads(raw: str) -> dict:
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}
