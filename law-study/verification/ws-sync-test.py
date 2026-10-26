#!/usr/bin/env python3
"""WebSocket 实时同步验收（端到端）。

用法：python3 verification/ws-sync-test.py <cookie.txt> [base_url]
  cookie.txt 为 curl Netscape 格式（含 law_sid），可用 curl -c 生成，避免在脚本里存口令。

流程：登录会话鉴权 → 连 /ws/sync → ping/pong → 模拟另一台设备 PUT 进度
     → 断言本连接收到 data 广播（含 senderId 与最新内容）→ 还原原始数据。
"""
import asyncio
import json
import sys
import time
import urllib.request


def read_cookie(path, name="law_sid"):
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]      # curl 对 HttpOnly cookie 会加这个前缀
        elif line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7 and parts[5] == name:
            return parts[6]
    raise SystemExit("cookie 文件中未找到 " + name)


def http(method, url, sid, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Cookie", "law_sid=" + sid)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cookie_path = sys.argv[1]
    base = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8123").rstrip("/")
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    sid = read_cookie(cookie_path)
    cid = "criminal-law-general"

    orig = http("GET", f"{base}/api/data/progress/{cid}", sid)
    original = orig.get("data") or {}
    if not original:
        raise SystemExit("服务端无进度数据，跳过以免误判")

    import websockets

    ok = fail = 0

    def ck(name, cond, extra=""):
        nonlocal ok, fail
        if cond:
            ok += 1
            print("  \u2713", name)
        else:
            fail += 1
            print("  \u2717", name, extra)

    try:
        ctx = websockets.connect(f"{ws_base}/ws/sync", additional_headers={"Cookie": "law_sid=" + sid})
        ws = await ctx.__aenter__()
    except TypeError:
        ctx = websockets.connect(f"{ws_base}/ws/sync", extra_headers={"Cookie": "law_sid=" + sid})
        ws = await ctx.__aenter__()

    ctx2 = None
    payload = {}
    try:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 5))
        ck("握手返回 hello", hello.get("type") == "hello", hello)

        await ws.send(json.dumps({"type": "ping"}))
        pong = json.loads(await asyncio.wait_for(ws.recv(), 5))
        ck("心跳 ping → pong", pong.get("type") == "pong", pong)

        # 第二台设备同时在线：验证广播覆盖同一账号的全部连接
        try:
            ctx2 = websockets.connect(f"{ws_base}/ws/sync", additional_headers={"Cookie": "law_sid=" + sid})
            ws2 = await ctx2.__aenter__()
        except TypeError:
            ctx2 = websockets.connect(f"{ws_base}/ws/sync", extra_headers={"Cookie": "law_sid=" + sid})
            ws2 = await ctx2.__aenter__()
        hello2 = json.loads(await asyncio.wait_for(ws2.recv(), 5))
        ck("第二台设备同时在线（hello）", hello2.get("type") == "hello", hello2)

        test_sid = "ch1-ws-e2e"
        payload = dict(original)
        payload["lastSid"] = test_sid
        # 保证一定赢 LWW：不小于“原值+2 秒”，避免与上一轮还原的时间戳赛跑
        payload["updatedAt"] = max(int(time.time() * 1000), int(original.get("updatedAt") or 0) + 2000)
        http("PUT", f"{base}/api/data/progress/{cid}", sid,
             {"data": payload, "clientUpdatedAt": payload["updatedAt"], "clientId": "ws-test-other-device"})

        got = None
        deadline = time.time() + 6
        while time.time() < deadline:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), max(0.1, deadline - time.time())))
            except asyncio.TimeoutError:
                break
            if msg.get("type") == "data" and msg.get("kind") == "progress":
                got = msg
                break
        ck("收到另一设备的进度广播", bool(got), "6 秒内未收到")
        if got:
            ck("广播携带 senderId（供回声跳过）", got.get("senderId") == "ws-test-other-device", got.get("senderId"))
            ck("广播内容即最新合并结果", (got.get("data") or {}).get("lastSid") == test_sid,
               (got.get("data") or {}).get("lastSid"))
            ck("广播携带 updatedAt", int(got.get("updatedAt") or 0) > 0, got.get("updatedAt"))

        got2 = None
        deadline2 = time.time() + 6
        while time.time() < deadline2:
            try:
                msg2 = json.loads(await asyncio.wait_for(ws2.recv(), max(0.1, deadline2 - time.time())))
            except asyncio.TimeoutError:
                break
            if msg2.get("type") == "data" and msg2.get("kind") == "progress":
                got2 = msg2
                break
        ck("第二台设备同样收到广播", bool(got2), "6 秒内未收到")
        if got2:
            ck("两台收到内容一致", (got2.get("data") or {}).get("lastSid") == test_sid, (got2.get("data") or {}).get("lastSid"))
    finally:
        try:
            await ctx.__aexit__(None, None, None)
        except Exception:
            pass
        if ctx2 is not None:
            try:
                await ctx2.__aexit__(None, None, None)
            except Exception:
                pass
        restore = dict(original)
        restore["updatedAt"] = max(int(time.time() * 1000), int(payload.get("updatedAt") or 0) + 2000)
        http("PUT", f"{base}/api/data/progress/{cid}", sid,
             {"data": restore, "clientUpdatedAt": restore["updatedAt"], "clientId": "ws-test-restore"})
        back = http("GET", f"{base}/api/data/progress/{cid}", sid).get("data") or {}
        ck("测试后已还原 lastSid", back.get("lastSid") == original.get("lastSid"),
           f'{back.get("lastSid")} vs {original.get("lastSid")}')
        ck("测试后已还原已读集合", len(back.get("read") or {}) >= len(original.get("read") or {}),
           len(back.get("read") or {}))

    print(f"\n通过 {ok} / 失败 {fail}")
    sys.exit(1 if fail else 0)


asyncio.run(main())
