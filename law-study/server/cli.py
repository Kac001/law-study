"""管理员命令行：建号、改密、列用户、备份数据库。

用法：
  python3 -m server.cli create-admin <username> [--display 显示名]
  python3 -m server.cli create-user  <username> [--display 显示名]
  python3 -m server.cli reset-password <username>
  python3 -m server.cli list
  python3 -m server.cli backup
密码从标准输入读取，不出现在命令行参数与进程列表里。
"""
import argparse
import getpass
import os
import sqlite3
import sys
import time

from . import auth, db


def _read_password(prompt: str = "密码（至少 8 位）: ") -> str:
    pw = getpass.getpass(prompt)
    if not auth.password_ok(pw):
        print(f"✗ 密码至少 {auth.MIN_PASSWORD_LEN} 位", file=sys.stderr)
        raise SystemExit(1)
    if getpass.getpass("再输一次: ") != pw:
        print("✗ 两次输入不一致", file=sys.stderr)
        raise SystemExit(1)
    return pw


def cmd_create(username: str, display: str | None, is_admin: bool) -> None:
    db.init_db()
    conn = db.get_conn()
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        print(f"✗ 用户已存在: {username}", file=sys.stderr)
        raise SystemExit(1)
    pw = _read_password()
    conn.execute(
        "INSERT INTO users (username, password_hash, display_name, is_admin, created_at) VALUES (?,?,?,?,?)",
        (username, auth.hash_password(pw), display, 1 if is_admin else 0, int(time.time())),
    )
    conn.commit()
    print(f"✓ 已创建{'管理员' if is_admin else '用户'}: {username}")


def cmd_reset(username: str) -> None:
    db.init_db()
    conn = db.get_conn()
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        print(f"✗ 用户不存在: {username}", file=sys.stderr)
        raise SystemExit(1)
    pw = _read_password("新密码: ")
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (auth.hash_password(pw), row["id"]))
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
    conn.commit()
    print(f"✓ 已重置密码并注销其全部会话: {username}")


def cmd_list() -> None:
    db.init_db()
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT u.id, u.username, u.display_name, u.is_admin, u.status, u.created_at, u.last_login_at
             FROM users u ORDER BY u.id"""
    ).fetchall()
    if not rows:
        print("（还没有用户，先建一个管理员：python3 -m server.cli create-admin <名字>）")
        return
    print(f"{'ID':>4}  {'用户名':<16} {'显示名':<12} {'管理员':<6} {'状态':<8} 最后登录")
    for r in rows:
        last = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["last_login_at"])) if r["last_login_at"] else "—"
        print(f"{r['id']:>4}  {r['username']:<16} {(r['display_name'] or ''):<12} "
              f"{'是' if r['is_admin'] else '否':<6} {r['status']:<8} {last}")


def cmd_backup() -> None:
    db.init_db()
    src = db.DB_PATH
    if not os.path.exists(src):
        print("✗ 数据库不存在", file=sys.stderr)
        raise SystemExit(1)
    out_dir = os.path.join(os.path.dirname(src), "backups")
    os.makedirs(out_dir, exist_ok=True)
    dst = os.path.join(out_dir, f"law-study-{time.strftime('%Y%m%d-%H%M%S')}.db")
    s = sqlite3.connect(src)
    d = sqlite3.connect(dst)
    with d:
        s.backup(d)
    s.close()
    d.close()
    print(f"✓ 已备份到 {dst}")


def main() -> None:
    p = argparse.ArgumentParser(prog="server.cli")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("create-admin", help="创建管理员")
    a.add_argument("username")
    a.add_argument("--display")

    u = sub.add_parser("create-user", help="创建普通用户")
    u.add_argument("username")
    u.add_argument("--display")

    r = sub.add_parser("reset-password", help="重置密码")
    r.add_argument("username")

    sub.add_parser("list", help="列出用户")
    sub.add_parser("backup", help="备份数据库")

    args = p.parse_args()
    if args.cmd == "create-admin":
        cmd_create(args.username, args.display, True)
    elif args.cmd == "create-user":
        cmd_create(args.username, args.display, False)
    elif args.cmd == "reset-password":
        cmd_reset(args.username)
    elif args.cmd == "list":
        cmd_list()
    elif args.cmd == "backup":
        cmd_backup()


if __name__ == "__main__":
    main()
