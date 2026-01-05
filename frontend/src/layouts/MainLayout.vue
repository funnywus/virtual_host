<template>
  <div class="admin-layout">
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="logo-icon">🚀</span>
        <span class="logo-text">虚拟主机管理</span>
      </div>
      <div class="sidebar-menu">
        <router-link to="/admin-jm/subdomains" class="menu-item" :class="{ active: $route.path === '/admin-jm/subdomains' }">
          <span class="menu-icon">📁</span>子域名管理
        </router-link>
        <router-link to="/admin-jm/domains" class="menu-item" :class="{ active: $route.path === '/admin-jm/domains' }">
          <span class="menu-icon">🌐</span>域名管理
        </router-link>
        <router-link to="/admin-jm/servers" class="menu-item" :class="{ active: $route.path === '/admin-jm/servers' }">
          <span class="menu-icon">🖥️</span>服务器管理
        </router-link>
        <router-link to="/admin-jm/ftp" class="menu-item" :class="{ active: $route.path === '/admin-jm/ftp' }">
          <span class="menu-icon">📤</span>FTP账号
        </router-link>
        <router-link to="/admin-jm/dns-platforms" class="menu-item" :class="{ active: $route.path === '/admin-jm/dns-platforms' }">
          <span class="menu-icon">⚙️</span>DNS平台
        </router-link>
        <router-link to="/admin-jm/tags" class="menu-item" :class="{ active: $route.path === '/admin-jm/tags' }">
          <span class="menu-icon">🏷️</span>标签管理
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/admin-jm/users" class="menu-item" :class="{ active: $route.path === '/admin-jm/users' }">
          <span class="menu-icon">👥</span>用户管理
        </router-link>
      </div>
      <div class="sidebar-footer">
        <div class="version">v1.0.0</div>
      </div>
    </div>
    <div class="main-area">
      <div class="header">
        <div class="header-left">
          <span class="welcome">欢迎回来，</span>
          <span class="username">{{ userStore.user.username }}</span>
          <el-tag :type="userStore.isAdmin ? 'danger' : 'info'" size="small" style="margin-left:10px">
            {{ userStore.isAdmin ? '管理员' : '用户' }}
          </el-tag>
        </div>
        <div class="header-right">
          <el-button text @click="handleLogout" class="logout-btn">
            <el-icon style="margin-right:5px"><SwitchButton /></el-icon>退出登录
          </el-button>
        </div>
      </div>
      <div class="content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { SwitchButton } from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()

function handleLogout() {
  userStore.logout()
  router.push('/admin-jm/login')
}
</script>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.sidebar {
  width: 240px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-header {
  padding: 25px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-icon {
  font-size: 28px;
}

.logo-text {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.sidebar-menu {
  flex: 1;
  padding: 15px 12px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  margin-bottom: 6px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  transition: all 0.3s ease;
  font-size: 14px;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  transform: translateX(5px);
}

.menu-item.active {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
  font-weight: 500;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.menu-icon {
  margin-right: 12px;
  font-size: 18px;
}

.sidebar-footer {
  padding: 15px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.version {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  text-align: center;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: hidden;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 25px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
}

.welcome {
  color: #909399;
  font-size: 14px;
}

.username {
  color: #303133;
  font-weight: 600;
  font-size: 16px;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding-right: 5px;
}

/* 美化滚动条 */
.content::-webkit-scrollbar {
  width: 6px;
}

.content::-webkit-scrollbar-track {
  background: transparent;
}

.content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

.content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}

.logout-btn {
  color: #606266 !important;
}

.logout-btn:hover {
  color: var(--primary-color) !important;
}
</style>
