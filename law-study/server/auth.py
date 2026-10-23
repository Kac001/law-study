"""认证：scrypt 密码哈希、会话令牌、登录限流。"""
import base64
import hashlib
import hmac
import secrets
import time

SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
HASH_BYTES = 32

SESSION_TTL = 30 * 24 * 3600          # 30 天
COOKIE_NAME = "law_sid"
MIN_PASSWORD_LEN = 8


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=HASH_BYTES,
    )
    return "scrypt${}${}${}${}${}".format(
        SCRYPT_N, SCRYPT_R, SCRYPT_P,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(dk).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    """恒定时间比较；任何解析异常一律视为验证失败。"""
    try:
        algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.scrypt(
            password.encode("utf-8"), salt=salt,
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session_token() -> tuple[str, str, int]:
    """返回 (明文 token, 入库哈希, 过期时间)。明文只进 Cookie，不落库。"""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token), int(time.time()) + SESSION_TTL


class LoginLimiter:
    """进程内失败计数：同一 IP+用户名 15 分钟内最多 5 次失败。

    单进程部署足够；重启后计数清零，属可接受降级。
    """

    def __init__(self, max_fail: int = 5, window: int = 900):
        self.max_fail = max_fail
        self.window = window
        self._fail: dict[str, list[float]] = {}

    def _prune(self, key: str) -> list[float]:
        now = time.time()
        arr = [t for t in self._fail.get(key, []) if now - t < self.window]
        if arr:
            self._fail[key] = arr
        else:
            self._fail.pop(key, None)
        return arr

    def allowed(self, key: str) -> bool:
        return len(self._prune(key)) < self.max_fail

    def record_failure(self, key: str) -> None:
        self._prune(key)
        self._fail.setdefault(key, []).append(time.time())

    def reset(self, key: str) -> None:
        self._fail.pop(key, None)


def password_ok(password: str) -> bool:
    return isinstance(password, str) and len(password) >= MIN_PASSWORD_LEN
