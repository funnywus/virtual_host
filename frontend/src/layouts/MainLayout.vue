<template>
  <div class="admin-layout" :class="{ collapsed: isCollapsed, 'mobile-menu-open': mobileMenuOpen }">
    <!-- 移动端遮罩层 -->
    <div class="mobile-overlay" v-if="mobileMenuOpen" @click="closeMobileMenu"></div>
    
    <!-- 侧边栏 -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="logo-icon">🚀</span>
        <span class="logo-text" v-show="!isCollapsed">虚拟主机管理</span>
        <!-- 移动端关闭按钮 -->
        <span class="mobile-close" @click="closeMobileMenu">✕</span>
      </div>
      <div class="sidebar-menu">
        <router-link to="/admin-jm/subdomains" class="menu-item" :class="{ active: $route.path === '/admin-jm/subdomains' }" @click="handleMenuClick">
          <span class="menu-icon">📁</span><span class="menu-text" v-show="!isCollapsed">子域名管理</span>
        </router-link>
        <router-link to="/admin-jm/domains" class="menu-item" :class="{ active: $route.path === '/admin-jm/domains' }" @click="handleMenuClick">
          <span class="menu-icon">🌐</span><span class="menu-text" v-show="!isCollapsed">域名管理</span>
        </router-link>
        <router-link to="/admin-jm/servers" class="menu-item" :class="{ active: $route.path === '/admin-jm/servers' }" @click="handleMenuClick">
          <span class="menu-icon">🖥️</span><span class="menu-text" v-show="!isCollapsed">服务器管理</span>
        </router-link>
        <router-link to="/admin-jm/ftp" class="menu-item" :class="{ active: $route.path === '/admin-jm/ftp' }" @click="handleMenuClick">
          <span class="menu-icon">📤</span><span class="menu-text" v-show="!isCollapsed">FTP账号</span>
        </router-link>
        <router-link to="/admin-jm/dns-platforms" class="menu-item" :class="{ active: $route.path === '/admin-jm/dns-platforms' }" @click="handleMenuClick">
          <span class="menu-icon">☁️</span><span class="menu-text" v-show="!isCollapsed">DNS平台</span>
        </router-link>
        <router-link to="/admin-jm/tags" class="menu-item" :class="{ active: $route.path === '/admin-jm/tags' }" @click="handleMenuClick">
          <span class="menu-icon">🏷️</span><span class="menu-text" v-show="!isCollapsed">标签管理</span>
        </router-link>
        <router-link to="/admin-jm/users" class="menu-item" :class="{ active: $route.path === '/admin-jm/users' }" @click="handleMenuClick">
          <span class="menu-icon">👥</span><span class="menu-text" v-show="!isCollapsed">用户管理</span>
        </router-link>
        <router-link to="/admin-jm/settings" class="menu-item" :class="{ active: $route.path === '/admin-jm/settings' }" @click="handleMenuClick">
          <span class="menu-icon">⚙️</span><span class="menu-text" v-show="!isCollapsed">系统设置</span>
        </router-link>
      </div>
      <div class="sidebar-footer">
        <div class="collapse-btn" @click="toggleCollapse">
          <span>{{ isCollapsed ? '▶' : '◀' }}</span>
        </div>
        <div class="version" v-show="!isCollapsed">v1.0.0</div>
      </div>
    </div>
    
    <!-- 主内容区 -->
    <div class="main-area">
      <div class="header">
        <div class="header-left">
          <!-- 移动端菜单按钮 -->
          <button class="mobile-menu-btn" @click="toggleMobileMenu">
            <span></span>
            <span></span>
            <span></span>
          </button>
          <span class="welcome">欢迎回来，</span>
          <span class="username">{{ userStore.user.username }}</span>
          <el-tag :type="userStore.isAdmin ? 'danger' : 'info'" size="small" class="user-tag">
            {{ userStore.isAdmin ? '管理员' : '用户' }}
          </el-tag>
        </div>
        <div class="header-right">
          <el-button text @click="handleLogout" class="logout-btn">
            <el-icon style="margin-right:5px"><SwitchButton /></el-icon>
            <span class="logout-text">退出登录</span>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { SwitchButton } from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()
const isCollapsed = ref(false)
const mobileMenuOpen = ref(false)
const isMobile = ref(false)

// 检测是否为移动端
function checkMobile() {
  isMobile.value = window.innerWidth <= 768
  if (!isMobile.value) {
    mobileMenuOpen.value = false
  }
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

function toggleCollapse() {
  if (!isMobile.value) {
    isCollapsed.value = !isCollapsed.value
  }
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

function handleMenuClick() {
  if (isMobile.value) {
    closeMobileMenu()
  }
}

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
  position: relative;
}

.sidebar {
  width: 240px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  transition: width 0.3s ease, transform 0.3s ease;
  position: relative;
  z-index: 1000;
}

.admin-layout.collapsed .sidebar {
  width: 70px;
}

/* 移动端遮罩层 */
.mobile-overlay {
  display: none;
}

/* 移动端关闭按钮 */
.mobile-close {
  display: none;
}

.sidebar-header {
  padding: 25px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
  white-space: nowrap;
}

.admin-layout.collapsed .sidebar-header {
  justify-content: center;
  padding: 25px 10px;
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
  overflow: hidden;
  white-space: nowrap;
}

.admin-layout.collapsed .menu-item {
  justify-content: center;
  padding: 14px 10px;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  transform: translateX(5px);
}

.admin-layout.collapsed .menu-item:hover {
  transform: none;
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
  flex-shrink: 0;
}

.admin-layout.collapsed .menu-icon {
  margin-right: 0;
}

.sidebar-footer {
  padding: 15px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  transition: all 0.3s;
  margin-bottom: 10px;
}

.collapse-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
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


/* 移动端菜单按钮 */
.mobile-menu-btn {
  display: none;
  flex-direction: column;
  justify-content: space-around;
  width: 30px;
  height: 24px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-right: 15px;
}

.mobile-menu-btn span {
  width: 100%;
  height: 3px;
  background: #303133;
  border-radius: 2px;
  transition: all 0.3s ease;
}

.user-tag {
  margin-left: 10px;
}

/* ========== 移动端响应式样式 ========== */
@media (max-width: 768px) {
  .admin-layout {
    flex-direction: column;
  }

  /* 侧边栏移动端样式 */
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    height: 100vh;
    width: 280px;
    transform: translateX(-100%);
    z-index: 2000;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
  }

  .admin-layout.mobile-menu-open .sidebar {
    transform: translateX(0);
  }

  .admin-layout.collapsed .sidebar {
    width: 280px;
  }

  /* 移动端遮罩层 */
  .mobile-overlay {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1500;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* 移动端关闭按钮 */
  .mobile-close {
    display: block;
    margin-left: auto;
    font-size: 24px;
    color: #fff;
    cursor: pointer;
    padding: 5px;
    line-height: 1;
  }

  /* 显示菜单按钮 */
  .mobile-menu-btn {
    display: flex;
  }

  /* 隐藏折叠按钮 */
  .collapse-btn {
    display: none;
  }

  /* 主内容区 */
  .main-area {
    padding: 10px;
    width: 100%;
  }

  /* 头部 */
  .header {
    padding: 12px 15px;
    margin-bottom: 15px;
    border-radius: 12px;
  }

  .header-left {
    flex: 1;
    min-width: 0;
  }

  .welcome {
    display: none;
  }

  .username {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-tag {
    margin-left: 8px;
  }

  .logout-text {
    display: none;
  }

  /* 内容区 */
  .content {
    padding-right: 0;
  }

  /* 侧边栏菜单项 */
  .menu-item {
    padding: 14px 18px;
  }

  .menu-icon {
    margin-right: 12px;
  }

  .menu-text {
    display: inline !important;
  }

  .logo-text {
    display: inline !important;
  }

  .version {
    display: block !important;
  }
}

/* 平板端适配 (768px - 1024px) */
@media (min-width: 769px) and (max-width: 1024px) {
  .sidebar {
    width: 200px;
  }

  .admin-layout.collapsed .sidebar {
    width: 70px;
  }

  .main-area {
    padding: 15px;
  }

  .header {
    padding: 15px 20px;
  }
}

/* 小屏手机适配 (< 480px) */
@media (max-width: 480px) {
  .sidebar {
    width: 260px;
  }

  .header {
    padding: 10px 12px;
  }

  .username {
    font-size: 13px;
  }

  .user-tag {
    font-size: 11px;
    padding: 0 6px;
    height: 20px;
    line-height: 20px;
  }
}
