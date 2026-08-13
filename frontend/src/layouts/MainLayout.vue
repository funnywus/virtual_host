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
        <router-link to="/admin-jm/traffic" class="menu-item" :class="{ active: $route.path === '/admin-jm/traffic' }" @click="handleMenuClick">
          <span class="menu-icon">📊</span><span class="menu-text" v-show="!isCollapsed">流量统计</span>
        </router-link>
        <router-link to="/admin-jm/domains" class="menu-item" :class="{ active: $route.path === '/admin-jm/domains' }" @click="handleMenuClick">
          <span class="menu-icon">🌐</span><span class="menu-text" v-show="!isCollapsed">域名管理</span>
        </router-link>
        <router-link to="/admin-jm/dns" class="menu-item" :class="{ active: $route.path === '/admin-jm/dns' }" @click="handleMenuClick">
          <span class="menu-icon">📡</span><span class="menu-text" v-show="!isCollapsed">DNS记录</span>
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
        <router-link v-if="userStore.isAdmin" to="/admin-jm/users" class="menu-item" :class="{ active: $route.path === '/admin-jm/users' }" @click="handleMenuClick">
          <span class="menu-icon">👥</span><span class="menu-text" v-show="!isCollapsed">用户管理</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/admin-jm/settings" class="menu-item" :class="{ active: $route.path === '/admin-jm/settings' }" @click="handleMenuClick">
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
          <button class="mobile-menu-btn" type="button" aria-label="打开后台菜单" @click="toggleMobileMenu">
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
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
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
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  overscroll-behavior: none;
  background: linear-gradient(135deg, #F5F5F7 0%, #FAFAFA 100%);
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}

.admin-layout::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(0, 122, 255, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(88, 86, 214, 0.06) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(255, 149, 0, 0.03) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
  animation: backgroundPulse 20s ease-in-out infinite;
}

@keyframes backgroundPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.sidebar {
  width: 240px;
  height: 100%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(80px) saturate(180%);
  -webkit-backdrop-filter: blur(80px) saturate(180%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 0.5px solid rgba(255, 255, 255, 0.95);
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.9) inset,
    8px 0 32px rgba(0, 0, 0, 0.04);
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
  flex-shrink: 0;
  border-bottom: 1px solid rgba(209, 209, 214, 0.32);
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
  color: #1C1C1E;
  letter-spacing: -0.35px;
}

.sidebar-menu {
  flex: 1;
  min-height: 0;
  padding: 15px 12px;
  overflow-y: auto;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  margin-bottom: 6px;
  border-radius: 10px;
  color: #3C3C43;
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
  background: rgba(0, 122, 255, 0.07);
  color: #007AFF;
  transform: translateX(3px);
}

.admin-layout.collapsed .menu-item:hover {
  transform: none;
}

.menu-item.active {
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.14) 0%, rgba(0, 149, 255, 0.08) 100%);
  color: #007AFF;
  font-weight: 600;
  box-shadow:
    0 0 0 0.5px rgba(0, 122, 255, 0.18) inset,
    0 6px 18px rgba(0, 122, 255, 0.08);
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
  flex-shrink: 0;
  border-top: 1px solid rgba(209, 209, 214, 0.32);
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  cursor: pointer;
  color: #86868B;
  border-radius: 10px;
  transition: all 0.3s;
  margin-bottom: 10px;
}

.collapse-btn:hover {
  background: rgba(0, 122, 255, 0.07);
  color: #007AFF;
}

.version {
  color: #8E8E93;
  font-size: 12px;
  text-align: center;
}

.main-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  padding: 18px 25px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(80px) saturate(180%);
  -webkit-backdrop-filter: blur(80px) saturate(180%);
  border-radius: 20px;
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 8px 24px rgba(0, 0, 0, 0.04),
    0 1px 3px rgba(0, 0, 0, 0.02);
  border: 0.5px solid rgba(255, 255, 255, 1);
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
}

.welcome {
  color: #86868B;
  font-size: 14px;
}

.username {
  color: #1C1C1E;
  font-weight: 600;
  font-size: 16px;
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 5px;
  -webkit-overflow-scrolling: touch;
}

/* 美化滚动条 */
.content::-webkit-scrollbar {
  width: 6px;
}

.content::-webkit-scrollbar-track {
  background: transparent;
}

.content::-webkit-scrollbar-thumb {
  background: rgba(0, 122, 255, 0.18);
  border-radius: 3px;
}

.content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 122, 255, 0.28);
}

.logout-btn {
  color: #606266 !important;
}

.logout-btn:hover {
  color: var(--primary-color) !important;
}

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
  flex-shrink: 0;
}

.mobile-menu-btn span {
  width: 100%;
  height: 3px;
  background: #1C1C1E;
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
    height: 100dvh;
    background:
      radial-gradient(circle at 20% 30%, rgba(0, 122, 255, 0.08) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(88, 86, 214, 0.06) 0%, transparent 50%),
      linear-gradient(135deg, #F5F5F7 0%, #FAFAFA 100%);
  }

  /* 侧边栏移动端样式 */
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    height: 100dvh;
    width: min(82vw, 320px);
    transform: translateX(-100%);
    z-index: 2000;
    box-shadow: 18px 0 50px rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(80px) saturate(180%);
    -webkit-backdrop-filter: blur(80px) saturate(180%);
    border-right: 0.5px solid rgba(255, 255, 255, 1);
    padding-top: env(safe-area-inset-top);
  }

  .admin-layout.mobile-menu-open .sidebar {
    transform: translateX(0);
  }

  .admin-layout.collapsed .sidebar {
    width: min(82vw, 320px);
  }

  /* 移动端遮罩层 */
  .mobile-overlay {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(28, 28, 30, 0.28);
    backdrop-filter: blur(3px);
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
    color: #1C1C1E;
    cursor: pointer;
    padding: 5px;
    line-height: 1;
    min-width: 36px;
    text-align: center;
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
    padding: max(10px, env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom));
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* 头部 */
  .header {
    padding: 12px 15px;
    margin-bottom: 15px;
    border-radius: 12px;
    flex-shrink: 0;
    z-index: 50;
    min-height: 54px;
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
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* 侧边栏菜单项 */
  .menu-item {
    padding: 15px 18px;
    min-height: 50px;
    border-radius: 14px;
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

  .sidebar-menu {
    overflow-y: auto;
    padding-bottom: 24px;
  }

  .sidebar-footer {
    padding-bottom: calc(15px + env(safe-area-inset-bottom));
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
    width: min(86vw, 300px);
  }

  .header {
    padding: 10px 12px;
    gap: 8px;
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

  .mobile-menu-btn {
    width: 28px;
    height: 22px;
    margin-right: 10px;
  }

  .main-area {
    padding-left: 8px;
    padding-right: 8px;
  }
}
</style>
