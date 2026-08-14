# 管理后台 React + Ant Design 拆分计划

> **For Claude:** 按任务顺序落地；未完成页面不要切生产路由。

**Goal:** 把管理后台从 Vue 拆成独立 React 应用，公开上传页继续用现有 Vue。

**Architecture:** `admin/` 是 React 管理后台（开发 `5174`，`basename` `/admin-jm`）。`frontend/` 只负责公开上传页。生产由 Express 分发：`/admin-jm/*` → `backend/public/admin-jm/index.html`，其余 → `backend/public/index.html`。

**Tech Stack:** React 18、React Router 6、Zustand、TanStack Query、Ant Design 5、Axios、Vite。JavaScript，不上 TypeScript / Next / Umi。

---

## 已定决策

| 项 | 选择 |
|---|---|
| 范围 | 只迁 `/admin-jm/*`，上传页不动 |
| 语言 | JavaScript |
| 目录 | `admin/` 管理后台；`frontend/` 仅上传页 |
| 状态 | Zustand 只放登录态；列表走 TanStack Query |
| 切换生产 | 已切：`/admin-jm/*` 走 React，`/` 走 Vue 上传页 |

## 页面迁移顺序

1. 脚手架 + 登录 + 布局
2. 标签 / 用户 / DNS 平台
3. DNS 记录 / FTP / 流量
4. 域名 / 服务器（含终端、文件管理）
5. 系统设置
6. 子域名（含 Nginx 弹窗）
7. 切生产路由（已做）：`server.js` + `deploy.sh`；Vue 路由只留上传页

## 开发

```bash
cd admin && npm install && npm run dev
# http://localhost:5174/admin-jm/login
```

上传页：`frontend` → `http://localhost:5173/`。生产构建先 Vue 再 React。
