/** PM2 配置 —— 多课程学习系统（FastAPI：静态 + 账号/进度同步，端口 8123） */
module.exports = {
  apps: [
    {
      name: "law-study",
      cwd: __dirname,
      script: "/usr/bin/python3",
      args: ["-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8123", "--proxy-headers", "--forwarded-allow-ips", "*"],
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      max_memory_restart: "300M",
      watch: false,
      time: true,
      env: {
        LAW_DB_PATH: "/home/openclaw/.openclaw/workspace-fullstack-dev/law-study/data/law-study.db",
        LAW_COOKIE_SECURE: "0",
      },
    },
  ],
};
