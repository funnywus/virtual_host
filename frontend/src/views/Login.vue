<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-box">
        <div class="login-header">
          <div class="login-logo">🔐</div>
          <h2 class="login-title">管理后台</h2>
          <p class="login-subtitle">请登录您的管理员账号</p>
        </div>
        
        <el-form :model="form" class="login-form">
          <el-form-item>
            <el-input v-model="form.username" placeholder="请输入用户名" size="large" prefix-icon="User" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" prefix-icon="Lock" show-password @keyup.enter="handleAuth" />
          </el-form-item>
          <div class="login-options">
            <el-checkbox v-model="rememberPassword" @change="handleRememberChange">记住密码</el-checkbox>
          </div>
          <el-form-item>
            <el-button type="primary" size="large" :loading="loading" @click="handleAuth" class="login-btn">
              登 录
            </el-button>
          </el-form-item>
        </el-form>
      </div>
      
      <div class="login-decoration">
        <div class="decoration-circle circle-1"></div>
        <div class="decoration-circle circle-2"></div>
        <div class="decoration-circle circle-3"></div>
      </div>
    </div>
    
    <div class="login-footer-text">
      文件管理系统 · 安全可靠
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials
} from '@/utils/remember-credentials'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const restoringCredentials = ref(true)
const form = reactive({ username: '', password: '' })
const rememberPassword = ref(false)

onMounted(async () => {
  try {
    const remembered = await loadRememberedCredentials()
    if (remembered?.username) {
      form.username = remembered.username
      form.password = remembered.password || ''
      rememberPassword.value = true
    }
  } finally {
    restoringCredentials.value = false
  }
})

function handleRememberChange(checked) {
  if (!checked) {
    clearRememberedCredentials()
    form.password = ''
  }
}

async function handleAuth() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await userStore.login(form.username, form.password)
    if (rememberPassword.value) {
      await saveRememberedCredentials(form.username, form.password)
    } else {
      clearRememberedCredentials()
    }
    ElMessage.success('登录成功')
    router.push('/admin-jm')
  } catch (e) {
    // 错误已在拦截器处理
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
}

.login-container {
  position: relative;
  z-index: 1;
}

.login-box {
  width: 420px;
  padding: 50px 40px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 20px;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px);
  animation: slideUp 0.5s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-header {
  text-align: center;
  margin-bottom: 35px;
}

.login-logo {
  font-size: 56px;
  margin-bottom: 15px;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.login-title {
  font-size: 26px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

.login-subtitle {
  color: #909399;
  font-size: 14px;
}

.login-form {
  margin-bottom: 20px;
}

.login-options {
  display: flex;
  justify-content: flex-end;
  margin: -4px 0 18px;
  color: #606266;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 4px 15px;
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
}

.login-form :deep(.el-form-item) {
  margin-bottom: 22px;
}

.login-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 500;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  transition: all 0.3s ease;
}

.login-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.login-btn:active {
  transform: translateY(0);
}

/* 装饰圆圈 */
.login-decoration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: hidden;
}

.decoration-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
}

.circle-1 {
  width: 300px;
  height: 300px;
  top: -100px;
  right: -100px;
  animation: float 6s ease-in-out infinite;
}

.circle-2 {
  width: 200px;
  height: 200px;
  bottom: -50px;
  left: -80px;
  animation: float 8s ease-in-out infinite reverse;
}

.circle-3 {
  width: 150px;
  height: 150px;
  top: 50%;
  left: -60px;
  animation: float 7s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-20px) rotate(10deg); }
}

.login-footer-text {
  position: absolute;
  bottom: 30px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

/* 响应式 */
@media (max-width: 480px) {
  .login-box {
    width: 90%;
    padding: 40px 25px;
  }
  
  .login-logo {
    font-size: 48px;
  }
  
  .login-title {
    font-size: 22px;
  }
}
</style>
