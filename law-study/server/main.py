"""FastAPI 应用：认证 + 进度同步 + 静态托管。"""
import json
import os
import time
from typing import Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, db, merge

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COOKIE_SECURE = os.environ.get("LAW_COOKIE_SECURE", "0") == "1"

app = FastAPI(title="law-study", docs_url=None, redoc_url=None)
limiter = auth.LoginLimiter()

ALLOWED_KINDS = {"progress", "drill"}
MAX_PAYLOAD = 2 * 1024 * 1024  # 单个进度块上限 2MB


# ---------- 模型 ----------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class CreateUserIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    display_name: Optional[str] = Field(default=None, max_length=64)


class SyncIn(BaseModel):
    data: dict
    clientUpdatedAt: int = 0


# ---------- 工具 ----------
def _now() -> int:
    return int(time.time())


def current_user(request: Request) -> dict:
    token = request.cookies.get(auth.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    conn = db.get_conn()
    row = conn.execute(
        """SELECT u.id, u.username, u.display_name, u.is_admin
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'""",
        (auth.token_hash(token), _now()),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="会话已失效")
    return dict(row)


def admin_user(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        max_age=auth.SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


# ---------- 认证 ----------
@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    key = f"{request.client.host if request.client else '?'}:{body.username.lower()}"
    if not limiter.allowed(key):
        raise HTTPException(status_code=429, detail="尝试过于频繁，请 15 分钟后再试")

    conn = db.get_conn()
    row = conn.execute(
        "SELECT id, username, password_hash, status FROM users WHERE username = ?",
        (body.username.strip(),),
    ).fetchone()

    if not row or row["status"] != "active" or not auth.verify_password(body.password, row["password_hash"]):
        limiter.record_failure(key)
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    limiter.reset(key)
    token, thash, expires = auth.new_session_token()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ua, ip) VALUES (?,?,?,?,?,?)",
        (thash, row["id"], _now(), expires,
         (request.headers.get("user-agent") or "")[:200],
         request.client.host if request.client else ""),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), row["id"]))
    conn.commit()
    set_session_cookie(response, token)
    return {"ok": True, "user": {"username": row["username"]}}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(auth.COOKIE_NAME)
    if token:
        conn = db.get_conn()
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (auth.token_hash(token),))
        conn.commit()
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {
        "ok": True,
        "user": {
            "username": user["username"],
            "displayName": user.get("display_name") or user["username"],
            "isAdmin": bool(user.get("is_admin")),
        },
    }


# ---------- 管理员建号 ----------
@app.post("/api/admin/users")
def create_user(body: CreateUserIn, admin: dict = Depends(admin_user)):
    if not auth.password_ok(body.password):
        raise HTTPException(status_code=400, detail=f"密码至少 {auth.MIN_PASSWORD_LEN} 位")
    conn = db.get_conn()
    exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (body.username.strip(),)).fetchone()
    if exists:
        raise HTTPException(status_code=409, detail="用户名已存在")
    conn.execute(
        "INSERT INTO users (username, password_hash, display_name, is_admin, created_at) VALUES (?,?,?,0,?)",
        (body.username.strip(), auth.hash_password(body.password), body.display_name, _now()),
    )
    conn.commit()
    return {"ok": True}


@app.get("/api/admin/users")
def list_users(admin: dict = Depends(admin_user)):
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT u.id, u.username, u.display_name, u.is_admin, u.status, u.created_at, u.last_login_at,
                  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
             FROM users u ORDER BY u.id""",
        (_now(),),
    ).fetchall()
    return {"ok": True, "users": [dict(r) for r in rows]}


class PasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=256)


@app.post("/api/admin/users/{user_id}/password")
def reset_password(user_id: int, body: PasswordIn, admin: dict = Depends(admin_user)):
    conn = db.get_conn()
    if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
        raise HTTPException(status_code=404, detail="用户不存在")
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                 (auth.hash_password(body.password), user_id))
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # 改密后强制重新登录
    conn.commit()
    return {"ok": True}


# ---------- 进度同步 ----------
def _load_kind(user_id: int, kind: str, course_id: str) -> tuple[dict, int]:
    conn = db.get_conn()
    row = conn.execute(
        "SELECT data_json, updated_at FROM user_data WHERE user_id=? AND kind=? AND course_id=?",
        (user_id, kind, course_id),
    ).fetchone()
    if not row:
        return {}, 0
    return merge.loads(row["data_json"]), int(row["updated_at"] or 0)


def _save_kind(user_id: int, kind: str, course_id: str, data: dict) -> int:
    conn = db.get_conn()
    ts = _now()
    conn.execute(
        """INSERT INTO user_data (user_id, kind, course_id, data_json, updated_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, kind, course_id)
           DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at""",
        (user_id, kind, course_id, merge.dumps(data), ts),
    )
    conn.commit()
    return ts


@app.get("/api/data/{kind}/{course_id}")
def get_data(kind: str, course_id: str, user: dict = Depends(current_user)):
    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="未知数据类型")
    data, ts = _load_kind(user["id"], kind, course_id)
    return {"ok": True, "data": data, "updatedAt": ts}


@app.put("/api/data/{kind}/{course_id}")
def put_data(kind: str, course_id: str, body: SyncIn, user: dict = Depends(current_user)):
    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="未知数据类型")
    if len(merge.dumps(body.data)) > MAX_PAYLOAD:
        raise HTTPException(status_code=413, detail="数据过大")

    server, _ = _load_kind(user["id"], kind, course_id)
    merged = merge.merge_progress(server, body.data) if kind == "progress" else merge.merge_drill(server, body.data)
    ts = _save_kind(user["id"], kind, course_id, merged)
    return {"ok": True, "data": merged, "updatedAt": ts}


class SettingsIn(BaseModel):
    data: dict


@app.get("/api/settings")
def get_settings(user: dict = Depends(current_user)):
    data, ts = _load_kind(user["id"], "settings", "")
    return {"ok": True, "data": data, "updatedAt": ts}


@app.put("/api/settings")
def put_settings(body: SettingsIn, user: dict = Depends(current_user)):
    ts = _save_kind(user["id"], "settings", "", body.data)
    return {"ok": True, "data": body.data, "updatedAt": ts}


@app.get("/api/export")
def export_all(user: dict = Depends(current_user)):
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT kind, course_id, data_json, updated_at FROM user_data WHERE user_id = ?",
        (user["id"],),
    ).fetchall()
    payload = {
        "username": user["username"],
        "exportedAt": _now(),
        "items": [
            {"kind": r["kind"], "courseId": r["course_id"],
             "data": merge.loads(r["data_json"]), "updatedAt": r["updated_at"]}
            for r in rows
        ],
    }
    return JSONResponse(payload, headers={
        "Content-Disposition": f'attachment; filename="law-study-{user["username"]}.json"'
    })


@app.get("/api/health")
def health():
    return {"ok": True, "ts": _now()}


# ---------- 静态托管（放在最后，避免吃掉 /api） ----------
BLOCKED_PREFIXES = ("server", "data", "legacy", "design-plans", "verification", "scripts", ".git")


@app.middleware("http")
async def guard_sensitive_paths(request: Request, call_next):
    """静态目录是整个项目根，必须挡掉源码、数据库与备份。"""
    path = request.url.path.lstrip("/")
    first = path.split("/", 1)[0]
    if first in BLOCKED_PREFIXES or first.startswith("."):
        return JSONResponse({"ok": False, "detail": "Not Found"}, status_code=404)
    if path.endswith((".db", ".db-wal", ".db-shm", ".py", ".md")):
        return JSONResponse({"ok": False, "detail": "Not Found"}, status_code=404)
    return await call_next(request)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()
    db.cleanup_expired_sessions(_now())


app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
