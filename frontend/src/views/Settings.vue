<template>
  <div class="card">
    <div class="card-title">
      <span>系统设置</span>
    </div>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- 数据库备份 -->
      <el-tab-pane label="数据库备份" name="backup">
        <div class="backup-section">
          <el-alert type="info" :closable="false" style="margin-bottom:20px">
            <template #title>
              <div style="font-size:13px;line-height:1.6">
                定期备份数据库可以防止数据丢失。备份文件将保存在服务器的 backend/backups 目录中。
              </div>
            </template>
          </el-alert>

          <div class="backup-actions">
            <el-button type="primary" size="large" @click="handleBackup" :loading="backing">
              <el-icon style="margin-right:8px"><Download /></el-icon>
              立即备份数据库
            </el-button>
            <el-button size="large" @click="loadBackupList" :loading="loadingBackups">
              <el-icon style="margin-right:8px"><Refresh /></el-icon>
              刷新备份列表
            </el-button>
          </div>

          <el-divider>备份文件列表</el-divider>

          <el-table :data="backupList" stripe v-loading="loadingBackups">
            <el-table-column label="文件名" min-width="200">
              <template #default="{ row }">
                <el-icon style="margin-right:5px"><Document /></el-icon>
                {{ row.filename }}
              </template>
            </el-table-column>
            <el-table-column label="文件大小" width="120">
              <template #default="{ row }">
                {{ formatSize(row.size) }}
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="180">
              <template #default="{ row }">
                {{ row.created_at }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button type="success" size="small" @click="downloadBackup(row)">
                  <el-icon style="margin-right:3px"><Download /></el-icon>
                  下载
                </el-button>
                <el-button type="danger" size="small" @click="deleteBackup(row)">
                  <el-icon style="margin-right:3px"><Delete /></el-icon>
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="backupList.length === 0 && !loadingBackups" class="empty-tip">
            <el-empty description="暂无备份文件" />
          </div>
        </div>
      </el-tab-pane>

      <!-- 系统信息 -->
      <el-tab-pane label="系统信息" name="info">
        <div class="info-section">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="系统版本">v1.0.0</el-descriptions-item>
            <el-descriptions-item label="Node.js 版本">{{ systemInfo.nodeVersion }}</el-descriptions-item>
            <el-descriptions-item label="数据库类型">{{ systemInfo.dbType }}</el-descriptions-item>
            <el-descriptions-item label="运行时间">{{ systemInfo.uptime }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Refresh, Document, Delete } from '@element-plus/icons-vue'
import api from '@/api'

const activeTab = ref('backup')
const backing = ref(false)
const loadingBackups = ref(false)
const backupList = ref([])
const systemInfo = reactive({
  nodeVersion: '-',
  dbType: '-',
  uptime: '-'
})

onMounted(() => {
  loadBackupList()
  loadSystemInfo()
})

// 立即备份
async function handleBackup() {
  backing.value = true
  try {
    const res = await api.post('/system/backup')
    ElMessage.success(`备份成功！文件: ${res.filename}`)
    loadBackupList()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '备份失败')
  } finally {
    backing.value = false
  }
}

// 加载备份列表
async function loadBackupList() {
  loadingBackups.value = true
  try {
    const res = await api.get('/system/backups')
    backupList.value = res.backups || []
  } catch (err) {
    ElMessage.error('加载备份列表失败')
  } finally {
    loadingBackups.value = false
  }
}

// 下载备份
function downloadBackup(backup) {
  const url = `/api/system/backup/download/${backup.filename}`
  const link = document.createElement('a')
  link.href = url
  link.download = backup.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  ElMessage.success('开始下载备份文件')
}

// 删除备份
async function deleteBackup(backup) {
  try {
    await ElMessageBox.confirm(`确定删除备份文件 "${backup.filename}"？`, '确认删除', {
      type: 'warning'
    })
    await api.delete(`/system/backup/${backup.filename}`)
    ElMessage.success('删除成功')
    loadBackupList()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err.response?.data?.error || '删除失败')
    }
  }
}

// 加载系统信息
async function loadSystemInfo() {
  try {
    const res = await api.get('/system/info')
    Object.assign(systemInfo, res)
  } catch (err) {
    console.error('加载系统信息失败', err)
  }
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
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
  color: #303133;
}

.backup-section {
  padding: 20px;
}

.backup-actions {
  display: flex;
  gap: 15px;
  margin-bottom: 30px;
}

.info-section {
  padding: 20px;
}

.empty-tip {
  padding: 40px 0;
  text-align: center;
}

:deep(.el-tabs--border-card) {
  border: none;
  box-shadow: none;
}

:deep(.el-tabs__header) {
  background: #f8f9fa;
  border-radius: 8px;
}

:deep(.el-tabs__content) {
  padding: 0;
}

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  .card {
    padding: 15px;
    border-radius: 12px;
  }

  .card-title {
    font-size: 16px;
  }

  .backup-section,
  .info-section {
    padding: 15px;
  }

  .backup-actions {
    flex-direction: column;
    gap: 10px;
  }

  .backup-actions .el-button {
    width: 100%;
  }

  /* 表格移动端优化 */
  :deep(.el-table) {
    font-size: 12px;
  }

  :deep(.el-table th),
  :deep(.el-table td) {
    padding: 8px 5px;
  }

  :deep(.el-table .cell) {
    padding: 0 5px;
  }

  /* 操作按钮优化 */
  :deep(.el-button--small) {
    padding: 5px 8px;
    font-size: 12px;
  }

  /* Descriptions 优化 */
  :deep(.el-descriptions) {
    font-size: 13px;
  }

  :deep(.el-descriptions__label) {
    width: 100px !important;
  }

  :deep(.el-descriptions__content) {
    font-size: 12px;
  }

  /* Alert 优化 */
  :deep(.el-alert) {
    padding: 10px;
    font-size: 12px;
  }

  /* Tabs 优化 */
  :deep(.el-tabs__item) {
    padding: 0 15px;
    font-size: 13px;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  .card {
    padding: 12px;
  }

  .card-title {
    font-size: 15px;
  }

  .backup-section,
  .info-section {
    padding: 10px;
  }

  :deep(.el-table) {
    font-size: 11px;
  }

  :deep(.el-button--small) {
    padding: 4px 6px;
    font-size: 11px;
  }

  :deep(.el-button--large) {
    padding: 10px 15px;
    font-size: 14px;
  }

  :deep(.el-divider) {
    margin: 15px 0;
  }

  :deep(.el-descriptions__label) {
    width: 80px !important;
    font-size: 12px;
  }

  :deep(.el-descriptions__content) {
    font-size: 11px;
  }
}
</style>
