<template>
  <div class="card">
    <div class="card-title">
      <span>服务器列表</span>
      <div>
        <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
        <el-button type="primary" size="small" @click="openDialog()">添加服务器</el-button>
      </div>
    </div>
    <el-table :data="dataStore.servers" stripe>
      <el-table-column prop="name" label="名称" width="120">
        <template #default="{ row }">
          {{ row.name }}
          <el-tag v-if="row.is_default === 1" type="warning" size="small" style="margin-left:5px">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="IP地址" width="130"/>
      <el-table-column prop="port" label="端口" width="80" />
      <el-table-column label="标签" width="80">
        <template #default="{ row }">
          <el-tag v-for="tag in parseTags(row.tags)" :key="tag" :style="getTagStyle(tag)" size="small" style="margin-right:4px">{{ tag }}</el-tag>
          <span v-if="!row.tags" style="color:#999">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="username" label="用户名" />
      <el-table-column label="密码" width="100">
        <template #default="{ row }">
          <span>{{ showPassword[row.id] ? row.password : '********' }}</span>
          <el-icon class="copy-btn" @click="showPassword[row.id] = !showPassword[row.id]" style="margin-left:5px">
            <View v-if="!showPassword[row.id]" /><Hide v-else />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="添加时间" width="140">
        <template #default="{ row }">
          <span style="font-size:12px;color:#909399">{{ row.created_at }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="testServer(row)" :loading="row.testing">测试</el-button>
          <el-dropdown trigger="click" style="margin-left:8px">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openFileManager(row)">文件管理</el-dropdown-item>
                <el-dropdown-item @click="openTerminal(row)">终端</el-dropdown-item>
                <el-dropdown-item @click="viewDomains(row)">查看域名</el-dropdown-item>
                <el-dropdown-item @click="setDefault(row)" :disabled="row.is_default === 1">设为默认</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row.id)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑服务器' : '添加服务器'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="服务器名称" />
        </el-form-item>
        <el-form-item label="IP地址">
          <el-input v-model="form.ip" placeholder="服务器IP" />
        </el-form-item>
        <el-form-item label="SSH端口">
          <el-input-number v-model="form.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="SSH用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" :placeholder="form.id ? '留空则不修改' : 'SSH密码'" show-password />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="form.tagList" multiple filterable allow-create default-first-option placeholder="选择或输入标签" style="width:100%" @change="onTagChange">
            <el-option v-for="t in dataStore.serverTags" :key="t.id" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- 文件管理 -->
    <FileManager v-model="fileManagerVisible" :server="currentServer" />
    
    <!-- 终端 -->
    <ServerTerminal v-model="terminalVisible" :server="currentServer" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { View, Hide, ArrowDown, Refresh } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'
import FileManager from '@/components/FileManager.vue'
import ServerTerminal from '@/components/ServerTerminal.vue'

const dataStore = useDataStore()
const dialogVisible = ref(false)
const fileManagerVisible = ref(false)
const terminalVisible = ref(false)
const currentServer = ref(null)
const saving = ref(false)
const loading = ref(false)
const showPassword = ref({})
const form = reactive({ id: null, name: '', ip: '', port: 22, username: '', password: '', tagList: [] })

onMounted(() => {
  loadData()
  dataStore.loadServerTags()
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadServers()
  } finally {
    loading.value = false
  }
}

function parseTags(tags) {
  if (!tags) return []
  return tags.split(',').filter(t => t.trim())
}

function getTagColor(tagName) {
  const tag = dataStore.serverTags.find(t => t.name === tagName)
  return tag?.color || ''
}

function getTagStyle(tagName) {
  const color = getTagColor(tagName)
  return color ? { backgroundColor: color, borderColor: color, color: '#fff' } : {}
}

function openDialog(row = null) {
  if (row) {
    Object.assign(form, { 
      id: row.id, name: row.name, ip: row.ip, port: row.port, 
      username: row.username, password: '', 
      tagList: parseTags(row.tags)
    })
  } else {
    const defaultTag = dataStore.serverTags.find(t => t.is_default === 1)
    Object.assign(form, { 
      id: null, name: '', ip: '', port: 22, username: '', password: '', 
      tagList: defaultTag ? [defaultTag.name] : [] 
    })
  }
  dialogVisible.value = true
}

async function onTagChange(tags) {
  for (const tag of tags) {
    const exists = dataStore.serverTags.some(t => t.name === tag)
    if (!exists) {
      try {
        await api.post('/tags', { name: tag })
        dataStore.loadServerTags()
      } catch (e) {}
    }
  }
}

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, tags: form.tagList.join(',') }
    if (form.id) await api.put('/servers/' + form.id, data)
    else await api.post('/servers', data)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    dataStore.loadServers()
  } finally { 
    saving.value = false 
  }
}

async function handleDelete(id) {
  await ElMessageBox.confirm('确定删除此服务器？', '提示')
  await api.delete('/servers/' + id)
  ElMessage.success('删除成功')
  dataStore.loadServers()
}

async function testServer(row) {
  row.testing = true
  try {
    const res = await api.post('/servers/' + row.id + '/test')
    res.success ? ElMessage.success(res.message) : ElMessage.error(res.message)
  } finally { 
    row.testing = false 
  }
}

async function viewDomains(row) {
  ElMessage.info('查看域名: ' + row.name)
}

function openFileManager(row) {
  currentServer.value = row
  fileManagerVisible.value = true
}

function openTerminal(row) {
  currentServer.value = row
  terminalVisible.value = true
}

async function setDefault(row) {
  await api.post(`/servers/${row.id}/set-default`)
  ElMessage.success('已设为默认')
  dataStore.loadServers()
}
</script>

<style scoped>
.card {
  background: rgba(255, 255, 255, 0.95);
  padding: 25px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #303133;
}

.copy-btn {
  cursor: pointer;
  color: #409eff;
  transition: color 0.3s;
}

.copy-btn:hover {
  color: #66b1ff;
}

:deep(.el-table) {
  border-radius: 10px;
  overflow: hidden;
}

:deep(.el-table th) {
  background: #f8f9fa !important;
  font-weight: 600;
}

:deep(.el-dialog) {
  border-radius: 16px;
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid #f0f0f0;
  padding: 20px 25px;
}

:deep(.el-dialog__body) {
  padding: 25px;
}

:deep(.el-dialog__footer) {
  border-top: 1px solid #f0f0f0;
  padding: 15px 25px;
}
</style>
