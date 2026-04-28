<template>
  <router-view />
</template>

<script setup>
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif; 
  background: linear-gradient(135deg, #F5F5F7 0%, #FAFAFA 100%);
  min-height: 100vh;
  overflow-x: hidden;
}

/* ========== 主题色变量 ========== */
:root {
  --primary-color: #007AFF;
  --primary-light: #66b2ff;
  --primary-dark: #0051D5;
  --secondary-color: #0095FF;
  --success-color: #34C759;
  --warning-color: #FF9500;
  --danger-color: #FF3B30;
  --info-color: #8E8E93;
  --text-primary: #1C1C1E;
  --text-regular: #3C3C43;
  --text-secondary: #86868B;
  --border-color: rgba(209, 209, 214, 0.45);
  --bg-color: #F5F5F7;
  --card-shadow: 0 0 0 0.5px rgba(255, 255, 255, 1) inset, 0 8px 32px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03);
  --card-radius: 20px;
}

/* ========== Element Plus 按钮样式覆盖 ========== */
.el-button--primary {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%) !important;
  border: none !important;
  transition: all 0.3s ease !important;
}

.el-button--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 122, 255, 0.28) !important;
  opacity: 0.95;
}

.el-button--primary:active {
  transform: translateY(0);
}

.el-button--success {
  background: linear-gradient(135deg, #34C759 0%, #30B350 100%) !important;
  border: none !important;
}

.el-button--success:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(52, 199, 89, 0.28) !important;
}

.el-button--warning {
  background: linear-gradient(135deg, #FF9500 0%, #FF6B00 100%) !important;
  border: none !important;
}

.el-button--warning:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 149, 0, 0.28) !important;
}

.el-button--danger {
  background: linear-gradient(135deg, #FF3B30 0%, #D70015 100%) !important;
  border: none !important;
}

.el-button--danger:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 59, 48, 0.28) !important;
}

.el-button--default {
  border-color: var(--border-color) !important;
  transition: all 0.3s ease !important;
}

.el-button--default:hover {
  color: var(--primary-color) !important;
  border-color: var(--primary-color) !important;
  background: rgba(0, 122, 255, 0.06) !important;
}

/* 小按钮圆角 */
.el-button--small {
  border-radius: 8px !important;
}

.el-button {
  border-radius: 10px !important;
  font-weight: 500 !important;
}

/* ========== Element Plus 表格样式覆盖 ========== */
.el-table {
  border-radius: 12px !important;
  overflow: hidden !important;
  --el-table-border-color: rgba(209, 209, 214, 0.35) !important;
}

.el-table th.el-table__cell {
  background: linear-gradient(135deg, rgba(248, 248, 250, 0.95) 0%, rgba(242, 242, 247, 0.88) 100%) !important;
  font-weight: 600 !important;
  color: var(--text-primary) !important;
  padding: 14px 0 !important;
}

.el-table td.el-table__cell {
  padding: 12px 0 !important;
}

.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: rgba(0, 122, 255, 0.025) !important;
}

.el-table__body tr:hover > td.el-table__cell {
  background: rgba(0, 122, 255, 0.06) !important;
}

/* ========== 后台与用户端统一的玻璃质感 ========== */
.admin-layout .card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.52) 100%) !important;
  backdrop-filter: blur(80px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(80px) saturate(180%) !important;
  border: 0.5px solid rgba(255, 255, 255, 1) !important;
  border-radius: 20px !important;
  box-shadow: var(--card-shadow) !important;
}

.admin-layout .card-title {
  color: var(--text-primary) !important;
  border-bottom: 1px solid rgba(209, 209, 214, 0.35) !important;
  letter-spacing: -0.2px;
}

.admin-layout .toolbar,
.admin-layout .backup-actions,
.admin-layout .software-actions {
  border-radius: 16px;
}

.admin-layout .el-table {
  background: rgba(255, 255, 255, 0.62) !important;
  box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.9) inset !important;
}

/* ========== Element Plus 标签样式覆盖 ========== */
.el-tag {
  border-radius: 6px !important;
}

/* ========== Element Plus 输入框样式覆盖 ========== */
.el-input__wrapper {
  border-radius: 10px !important;
  transition: all 0.3s ease !important;
}

.el-input__wrapper:hover {
  box-shadow: 0 0 0 1px var(--primary-light) inset !important;
}

.el-input__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--primary-color) inset !important;
}

.el-select .el-input__wrapper {
  border-radius: 10px !important;
}

/* ========== Element Plus 对话框样式覆盖 ========== */
.el-dialog {
  border-radius: var(--card-radius) !important;
  overflow: hidden !important;
}

.el-overlay-dialog {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.el-dialog {
  margin: 0 !important;
}

.el-dialog__header {
  background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%) !important;
  border-bottom: 1px solid #f0f0f0 !important;
  padding: 20px 25px !important;
  margin: 0 !important;
}

.el-dialog__title {
  font-weight: 600 !important;
  color: var(--text-primary) !important;
  font-size: 16px !important;
}

.el-dialog__body {
  padding: 25px !important;
}

.el-dialog__footer {
  border-top: 1px solid #f0f0f0 !important;
  padding: 15px 25px !important;
  background: #fafafa !important;
}

/* ========== Element Plus 下拉菜单样式覆盖 ========== */
.el-dropdown-menu {
  border-radius: 12px !important;
  padding: 8px !important;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.12) !important;
}

.el-dropdown-menu__item {
  border-radius: 8px !important;
  padding: 10px 16px !important;
  transition: all 0.2s ease !important;
}

.el-dropdown-menu__item:hover {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%) !important;
  color: var(--primary-color) !important;
}

/* ========== Element Plus 分页样式覆盖 ========== */
.el-pagination {
  --el-pagination-button-bg-color: #fff !important;
}

.el-pagination .el-pager li {
  border-radius: 8px !important;
  margin: 0 3px !important;
}

.el-pagination .el-pager li.is-active {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%) !important;
}

.el-pagination .btn-prev,
.el-pagination .btn-next {
  border-radius: 8px !important;
}

/* ========== Element Plus 消息提示样式覆盖 ========== */
.el-message {
  border-radius: 12px !important;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.15) !important;
}

.el-message-box {
  border-radius: var(--card-radius) !important;
}

/* ========== Element Plus 提示框样式覆盖 ========== */
.el-tooltip__popper {
  border-radius: 8px !important;
}

/* ========== Element Plus 开关样式覆盖 ========== */
.el-switch.is-checked .el-switch__core {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%) !important;
  border-color: var(--primary-color) !important;
}

/* ========== Element Plus 警告框样式覆盖 ========== */
.el-alert {
  border-radius: 12px !important;
}

/* ========== Element Plus 表单样式覆盖 ========== */
.el-form-item__label {
  font-weight: 500 !important;
  color: var(--text-primary) !important;
}

/* ========== 滚动条美化 ========== */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.3);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.5);
}

/* ========== 链接样式 ========== */
a {
  color: var(--primary-color);
  text-decoration: none;
  transition: color 0.3s ease;
}

a:hover {
  color: var(--primary-dark);
}

/* ========== 选中文本颜色 ========== */
::selection {
  background: rgba(102, 126, 234, 0.3);
  color: var(--text-primary);
}

/* ========== 移动端全局响应式样式 ========== */
@media (max-width: 768px) {
  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    min-height: 100dvh;
  }

  /* 卡片样式 */
  .card {
    padding: 15px !important;
    border-radius: 12px !important;
    overflow: hidden !important;
  }

  .card-title {
    font-size: 16px !important;
    margin-bottom: 15px !important;
    padding-bottom: 12px !important;
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 10px;
  }

  .card-title > div {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .card-title > div .el-input,
  .card-title > div .el-select,
  .card-title > div .el-button,
  .toolbar .el-input,
  .toolbar .el-select,
  .toolbar .el-button {
    min-height: 36px;
  }

  /* 表格移动端优化 */
  .el-table {
    font-size: 13px !important;
    width: 100% !important;
    max-width: 100% !important;
  }

  .el-table th.el-table__cell,
  .el-table td.el-table__cell {
    padding: 10px 8px !important;
  }

  .el-table .cell {
    line-height: 1.35 !important;
  }

  .el-table__inner-wrapper,
  .el-table__body-wrapper,
  .el-scrollbar,
  .el-scrollbar__wrap {
    max-width: 100% !important;
  }

  .el-table__body-wrapper {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }

  .el-table__fixed-right,
  .el-table__fixed {
    box-shadow: none !important;
  }

  /* 按钮组优化 */
  .el-button--small {
    padding: 6px 10px !important;
    font-size: 12px !important;
  }

  .el-button {
    padding: 8px 12px !important;
    min-height: 34px;
  }

  .el-button + .el-button {
    margin-left: 6px !important;
  }

  /* 输入框优化 */
  .el-input,
  .el-select {
    font-size: 14px !important;
  }

  /* 对话框优化 */
  .el-dialog {
    width: 95% !important;
    max-width: calc(100vw - 20px) !important;
    margin: 10px auto max(10px, env(safe-area-inset-bottom)) !important;
  }

  .el-overlay-dialog {
    align-items: flex-start !important;
    padding-top: max(10px, env(safe-area-inset-top));
  }

  .el-dialog__header {
    padding: 15px !important;
  }

  .el-dialog__body {
    padding: 15px !important;
    max-height: calc(100dvh - 170px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .el-dialog__footer {
    padding: 12px 15px !important;
    position: sticky;
    bottom: 0;
    z-index: 1;
  }

  .el-dialog__footer .dialog-footer,
  .el-dialog__footer > span {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  /* 表单优化 */
  .el-form-item {
    margin-bottom: 18px !important;
  }

  .el-form-item__label {
    font-size: 13px !important;
  }

  /* 分页优化 */
  .el-pagination {
    flex-wrap: wrap !important;
    justify-content: center !important;
    gap: 8px;
    white-space: normal !important;
  }

  .el-pagination .el-pagination__total,
  .el-pagination .el-pagination__sizes {
    margin: 0 !important;
  }

  .el-pagination .el-pager {
    margin: 0 !important;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* 标签优化 */
  .el-tag {
    font-size: 11px !important;
    padding: 0 6px !important;
    height: 22px !important;
    line-height: 22px !important;
  }

  /* 下拉菜单优化 */
  .el-dropdown-menu {
    max-width: 90vw !important;
  }

  .el-popper,
  .el-select__popper,
  .el-picker__popper {
    max-width: calc(100vw - 16px) !important;
  }

  /* 警告框优化 */
  .el-alert {
    padding: 10px 12px !important;
    font-size: 13px !important;
  }

  /* Tabs优化 */
  .el-tabs__item {
    padding: 0 15px !important;
    font-size: 13px !important;
  }

  .el-tabs__nav-wrap {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }

  /* 描述列表优化 */
  .el-descriptions {
    font-size: 13px !important;
  }

  .el-descriptions :deep(.el-descriptions__label) {
    width: 100px !important;
  }
}

/* 小屏手机优化 (< 480px) */
@media (max-width: 480px) {
  .card {
    padding: 12px !important;
    border-radius: 10px !important;
  }

  .card-title {
    font-size: 15px !important;
  }

  .el-table {
    font-size: 12px !important;
  }

  .el-button--small {
    padding: 5px 8px !important;
    font-size: 11px !important;
  }

  .el-dialog {
    width: 98% !important;
    max-width: calc(100vw - 12px) !important;
  }

  .el-dialog__body {
    max-height: calc(100dvh - 150px);
  }

  .el-message-box {
    width: calc(100vw - 24px) !important;
    max-width: calc(100vw - 24px) !important;
  }

  .el-form-item__label {
    font-size: 12px !important;
  }

  .el-pagination {
    font-size: 12px !important;
  }

  .el-pagination .el-pager li {
    min-width: 28px !important;
    height: 28px !important;
    line-height: 28px !important;
  }

  .el-pagination__jump,
  .el-pagination__sizes {
    display: none !important;
  }
}
</style>
