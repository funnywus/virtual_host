<template>
  <router-view />
</template>

<script setup>
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif; 
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

/* ========== 主题色变量 ========== */
:root {
  --primary-color: #667eea;
  --primary-light: #8b9ff5;
  --primary-dark: #5a6fd6;
  --secondary-color: #764ba2;
  --success-color: #67c23a;
  --warning-color: #e6a23c;
  --danger-color: #f56c6c;
  --info-color: #909399;
  --text-primary: #303133;
  --text-regular: #606266;
  --text-secondary: #909399;
  --border-color: #e4e7ed;
  --bg-color: #f5f7fa;
  --card-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  --card-radius: 16px;
}

/* ========== Element Plus 按钮样式覆盖 ========== */
.el-button--primary {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%) !important;
  border: none !important;
  transition: all 0.3s ease !important;
}

.el-button--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4) !important;
  opacity: 0.95;
}

.el-button--primary:active {
  transform: translateY(0);
}

.el-button--success {
  background: linear-gradient(135deg, #67c23a 0%, #5daf34 100%) !important;
  border: none !important;
}

.el-button--success:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(103, 194, 58, 0.4) !important;
}

.el-button--warning {
  background: linear-gradient(135deg, #e6a23c 0%, #d4940f 100%) !important;
  border: none !important;
}

.el-button--warning:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(230, 162, 60, 0.4) !important;
}

.el-button--danger {
  background: linear-gradient(135deg, #f56c6c 0%, #e64545 100%) !important;
  border: none !important;
}

.el-button--danger:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(245, 108, 108, 0.4) !important;
}

.el-button--default {
  border-color: var(--border-color) !important;
  transition: all 0.3s ease !important;
}

.el-button--default:hover {
  color: var(--primary-color) !important;
  border-color: var(--primary-color) !important;
  background: rgba(102, 126, 234, 0.05) !important;
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
  --el-table-border-color: #f0f0f0 !important;
}

.el-table th.el-table__cell {
  background: linear-gradient(135deg, #f8f9fa 0%, #f0f2f5 100%) !important;
  font-weight: 600 !important;
  color: var(--text-primary) !important;
  padding: 14px 0 !important;
}

.el-table td.el-table__cell {
  padding: 12px 0 !important;
}

.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: rgba(102, 126, 234, 0.02) !important;
}

.el-table__body tr:hover > td.el-table__cell {
  background: rgba(102, 126, 234, 0.06) !important;
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
</style>
