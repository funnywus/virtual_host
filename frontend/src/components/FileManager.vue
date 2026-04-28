<template>
  <el-dialog v-model="visible" :title="'📁 ' + server?.name + ' - 文件管理'" width="1000px" top="3vh" :close-on-click-modal="false" append-to-body>
    <div class="file-manager">
      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="nav-buttons">
          <el-button-group>
            <el-button @click="goBack" :disabled="currentPath === '/'">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <el-button @click="goToPath('/')">
              <el-icon><HomeFilled /></el-icon>
            </el-button>
            <el-button @click="loadFiles">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-button-group>
        </div>
        <div class="path-bar">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item @click="goToPath('/')" class="path-item">
              <el-icon><HomeFilled /></el-icon>
            </el-breadcrumb-item>
            <el-breadcrumb-item v-for="(part, index) in pathParts" :key="index" @click="goToPath('/' + pathParts.slice(0, index + 1).join('/'))" class="path-item">
              {{ part }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="action-buttons">
          <el-button type="primary" @click="showNewFolderDialog = true">
            <el-icon><FolderAdd /></el-icon> 新建
          </el-button>
          <el-button type="success" @click="showUploadDialog = true">
            <el-icon><Upload /></el-icon> 上传
          </el-button>
        </div>
      </div>

      <!-- 文件列表 -->
      <div class="file-grid" v-loading="loading">
        <div v-if="currentPath !== '/'" class="file-item" @dblclick="goBack">
          <div class="file-icon">📁</div>
          <div class="file-name">..</div>
        </div>
        <div v-for="file in files" :key="file.name" class="file-item" :class="{ selected: selectedFile === file }" 
             @click="selectedFile = file" @dblclick="handleDblClick(file)" @contextmenu.prevent="showContextMenu($event, file)">
          <div class="file-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</div>
          <div class="file-name" :title="file.name">{{ file.name }}</div>
          <div class="file-size">{{ file.type === 'file' ? formatSize(file.size) : '' }}</div>
        </div>
        <div v-if="!loading && files.length === 0" class="empty-state">
          <div class="empty-icon">📂</div>
          <p>当前目录为空</p>
        </div>
      </div>

      <!-- 状态栏 -->
      <div class="status-bar">
        <span>{{ files.length }} 个项目</span>
        <span v-if="selectedFile">已选择: {{ selectedFile.name }}</span>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click="contextMenu.visible = false">
      <div v-if="contextMenu.file?.type === 'file' && isEditable(contextMenu.file.name)" class="menu-item" @click="editFile(contextMenu.file)">
        <el-icon><Edit /></el-icon> 编辑
      </div>
      <div v-if="contextMenu.file?.type === 'file'" class="menu-item" @click="downloadFile(contextMenu.file)">
        <el-icon><Download /></el-icon> 下载
      </div>
      <div class="menu-item" @click="renameItem(contextMenu.file)">
        <el-icon><EditPen /></el-icon> 重命名
      </div>
      <div class="menu-item danger" @click="deleteItem(contextMenu.file)">
        <el-icon><Delete /></el-icon> 删除
      </div>
    </div>

    <!-- 新建文件夹对话框 -->
    <el-dialog v-model="showNewFolderDialog" title="新建文件夹" width="400px" append-to-body>
      <el-input v-model="newFolderName" placeholder="文件夹名称" @keyup.enter="createFolder">
        <template #prefix><el-icon><Folder /></el-icon></template>
      </el-input>
      <template #footer>
        <el-button @click="showNewFolderDialog = false">取消</el-button>
        <el-button type="primary" @click="createFolder" :loading="creating">创建</el-button>
      </template>
    </el-dialog>

    <!-- 上传对话框 -->
    <el-dialog v-model="showUploadDialog" title="上传文件" width="550px" append-to-body>
      <el-upload drag multiple :auto-upload="false" :file-list="uploadFiles" :on-change="handleUploadChange" :on-remove="handleUploadRemove">
        <el-icon class="el-icon--upload" style="font-size:48px;color:#409eff"><Upload /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">上传到: {{ currentPath }}</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="showUploadDialog = false; uploadFiles = []">取消</el-button>
        <el-button type="primary" @click="startUpload" :loading="uploading" :disabled="uploadFiles.length === 0">
          上传 {{ uploadFiles.length }} 个文件
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑文件对话框 -->
    <el-dialog v-model="showEditDialog" :title="'编辑: ' + editingFile?.name" width="900px" top="3vh" append-to-body :close-on-click-modal="false">
      <div class="editor-wrapper" v-loading="loadingContent">
        <el-input v-model="fileContent" type="textarea" :rows="22" class="code-editor" />
      </div>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveFile" :loading="savingFile">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="showRenameDialog" title="重命名" width="400px" append-to-body>
      <el-input v-model="newName" @keyup.enter="doRename">
        <template #prefix><el-icon><Edit /></el-icon></template>
      </el-input>
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="doRename" :loading="renaming">确定</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { HomeFilled, ArrowLeft, FolderAdd, Upload, Refresh, Edit, Download, Delete, Folder, EditPen } from '@element-plus/icons-vue'
import api from '@/api'

const props = defineProps({ modelValue: Boolean, server: Object })
const emit = defineEmits(['update:modelValue'])

const visible = ref(false)
const loading = ref(false)
const files = ref([])
const currentPath = ref('/')
const selectedFile = ref(null)

const contextMenu = ref({ visible: false, x: 0, y: 0, file: null })

const showNewFolderDialog = ref(false)
const newFolderName = ref('')
const creating = ref(false)

const showUploadDialog = ref(false)
const uploadFiles = ref([])
const uploading = ref(false)

const showEditDialog = ref(false)
const editingFile = ref(null)
const fileContent = ref('')
const loadingContent = ref(false)
const savingFile = ref(false)

const showRenameDialog = ref(false)
const renamingFile = ref(null)
const newName = ref('')
const renaming = ref(false)

const pathParts = computed(() => currentPath.value.split('/').filter(p => p))

watch(() => props.modelValue, (val) => {
  visible.value = val
  if (val && props.server) {
    currentPath.value = '/www/wwwroot/ftp'
    loadFiles()
  }
})

watch(visible, (val) => {
  emit('update:modelValue', val)
  if (!val) contextMenu.value.visible = false
})

// 点击其他地方关闭右键菜单
document.addEventListener('click', () => { contextMenu.value.visible = false })

const editableExts = ['txt', 'html', 'htm', 'css', 'js', 'json', 'xml', 'md', 'php', 'py', 'sh', 'sql', 'conf', 'ini', 'log', 'yml', 'yaml', 'env', 'htaccess']
const isEditable = (name) => editableExts.includes(name.split('.').pop().toLowerCase())

async function loadFiles() {
  if (!props.server) return
  loading.value = true
  selectedFile.value = null
  try {
    const res = await api.post(`/servers/${props.server.id}/files`, { path: currentPath.value })
    files.value = (res.files || []).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goBack() {
  const parts = currentPath.value.split('/').filter(p => p)
  parts.pop()
  currentPath.value = '/' + parts.join('/')
  loadFiles()
}

function goToPath(path) {
  currentPath.value = path || '/'
  loadFiles()
}

function handleDblClick(file) {
  if (file.type === 'directory') {
    currentPath.value = currentPath.value === '/' ? '/' + file.name : currentPath.value + '/' + file.name
    loadFiles()
  } else if (isEditable(file.name)) {
    editFile(file)
  }
}

function showContextMenu(e, file) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, file }
}

async function createFolder() {
  if (!newFolderName.value) return
  creating.value = true
  try {
    await api.post(`/servers/${props.server.id}/files/mkdir`, { path: currentPath.value, name: newFolderName.value })
    ElMessage.success('创建成功')
    showNewFolderDialog.value = false
    newFolderName.value = ''
    loadFiles()
  } catch (e) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function handleUploadChange(file, fileList) { uploadFiles.value = fileList }
function handleUploadRemove(file, fileList) { uploadFiles.value = fileList }

async function startUpload() {
  uploading.value = true
  let success = 0, failed = 0
  for (const item of uploadFiles.value) {
    try {
      const content = await fileToBase64(item.raw)
      await api.post(`/servers/${props.server.id}/files/upload`, { path: currentPath.value, filename: item.name, content })
      success++
    } catch (e) { failed++ }
  }
  uploading.value = false
  ElMessage.success(`上传完成: 成功${success}个${failed ? ', 失败' + failed + '个' : ''}`)
  showUploadDialog.value = false
  uploadFiles.value = []
  loadFiles()
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result.split(',')[1])
  reader.onerror = reject
  reader.readAsDataURL(file)
})

async function editFile(file) {
  editingFile.value = file
  fileContent.value = ''
  showEditDialog.value = true
  loadingContent.value = true
  try {
    const filePath = currentPath.value === '/' ? '/' + file.name : currentPath.value + '/' + file.name
    const res = await api.post(`/servers/${props.server.id}/files/read`, { path: filePath })
    fileContent.value = res.content || ''
  } catch (e) {
    ElMessage.error('读取失败: ' + e.message)
    showEditDialog.value = false
  } finally {
    loadingContent.value = false
  }
}

async function saveFile() {
  savingFile.value = true
  try {
    const filePath = currentPath.value === '/' ? '/' + editingFile.value.name : currentPath.value + '/' + editingFile.value.name
    await api.post(`/servers/${props.server.id}/files/write`, { path: filePath, content: fileContent.value })
    ElMessage.success('保存成功')
    showEditDialog.value = false
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    savingFile.value = false
  }
}

async function downloadFile(file) {
  try {
    const filePath = currentPath.value === '/' ? '/' + file.name : currentPath.value + '/' + file.name
    const res = await api.post(`/servers/${props.server.id}/files/read-binary`, { path: filePath })
    const blob = new Blob([Uint8Array.from(atob(res.content), c => c.charCodeAt(0))])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error('下载失败: ' + e.message)
  }
}

function renameItem(file) {
  renamingFile.value = file
  newName.value = file.name
  showRenameDialog.value = true
}

async function doRename() {
  if (!newName.value || newName.value === renamingFile.value.name) {
    showRenameDialog.value = false
    return
  }
  renaming.value = true
  try {
    const oldPath = currentPath.value === '/' ? '/' + renamingFile.value.name : currentPath.value + '/' + renamingFile.value.name
    const newPath = currentPath.value === '/' ? '/' + newName.value : currentPath.value + '/' + newName.value
    await api.post(`/servers/${props.server.id}/files/rename`, { oldPath, newPath })
    ElMessage.success('重命名成功')
    showRenameDialog.value = false
    loadFiles()
  } catch (e) {
    ElMessage.error('重命名失败: ' + e.message)
  } finally {
    renaming.value = false
  }
}

async function deleteItem(file) {
  await ElMessageBox.confirm(`确定删除 "${file.name}"？${file.type === 'directory' ? '\n文件夹内所有内容将被删除！' : ''}`, '确认删除', { type: 'warning' })
  try {
    const filePath = currentPath.value === '/' ? '/' + file.name : currentPath.value + '/' + file.name
    await api.post(`/servers/${props.server.id}/files/delete`, { path: filePath })
    ElMessage.success('删除成功')
    loadFiles()
  } catch (e) {
    ElMessage.error('删除失败: ' + e.message)
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  const icons = { jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', mp4: '🎬', avi: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵', pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦', html: '🌐', htm: '🌐', css: '🎨', js: '📜', ts: '📜', json: '📋', php: '🐘', py: '🐍', rb: '💎', go: '🔵', java: '☕', txt: '📄', md: '📝', sql: '🗃️', sh: '⚙️', bash: '⚙️', conf: '⚙️', ini: '⚙️', yml: '⚙️', yaml: '⚙️', env: '🔐', log: '📋', xml: '📰' }
  return icons[ext] || '📄'
}
</script>

<style scoped>
.file-manager { background: #f5f7fa; border-radius: 8px; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 15px; padding: 12px 15px; background: #fff; border-bottom: 1px solid #ebeef5; }
.nav-buttons { flex-shrink: 0; }
.path-bar { flex: 1; padding: 8px 15px; background: #f5f7fa; border-radius: 6px; }
.path-item { cursor: pointer; }
.path-item:hover { color: #409eff; }
.action-buttons { flex-shrink: 0; display: flex; gap: 8px; }

.file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; padding: 15px; min-height: 400px; max-height: 500px; overflow-y: auto; }
.file-item { display: flex; flex-direction: column; align-items: center; padding: 15px 10px; background: #fff; border-radius: 8px; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; }
.file-item:hover { background: #ecf5ff; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.file-item.selected { border-color: #409eff; background: #ecf5ff; }
.file-icon { font-size: 42px; margin-bottom: 8px; }
.file-name { font-size: 12px; color: #303133; text-align: center; word-break: break-all; max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.file-size { font-size: 11px; color: #909399; margin-top: 4px; }

.empty-state { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: #909399; }
.empty-icon { font-size: 64px; margin-bottom: 15px; }

.status-bar { display: flex; justify-content: space-between; padding: 8px 15px; background: #fff; border-top: 1px solid #ebeef5; font-size: 12px; color: #909399; }

.context-menu { position: fixed; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 6px 0; min-width: 150px; z-index: 9999; }
.menu-item { display: flex; align-items: center; gap: 8px; padding: 10px 15px; cursor: pointer; font-size: 13px; transition: background 0.2s; }
.menu-item:hover { background: #f5f7fa; }
.menu-item.danger { color: #f56c6c; }
.menu-item.danger:hover { background: #fef0f0; }

.editor-wrapper { border: 1px solid #dcdfe6; border-radius: 4px; overflow: hidden; }
.code-editor :deep(textarea) { font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important; font-size: 13px; line-height: 1.5; }

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  .toolbar {
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px;
  }

  .nav-buttons {
    order: 1;
  }

  .action-buttons {
    order: 2;
    width: 100%;
    justify-content: space-between;
  }

  .action-buttons .el-button {
    flex: 1;
    padding: 8px 10px;
    font-size: 12px;
  }

  .path-bar {
    order: 3;
    width: 100%;
    padding: 6px 10px;
    font-size: 12px;
  }

  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
    padding: 10px;
    max-height: 60vh;
  }

  .file-item {
    padding: 10px 5px;
  }

  .file-icon {
    font-size: 32px;
    margin-bottom: 6px;
  }

  .file-name {
    font-size: 11px;
  }

  .file-size {
    font-size: 10px;
  }

  .status-bar {
    flex-direction: column;
    gap: 5px;
    padding: 8px 10px;
    font-size: 11px;
  }

  .empty-state {
    padding: 40px 20px;
  }

  .empty-icon {
    font-size: 48px;
  }

  /* 对话框优化 */
  :deep(.el-dialog) {
    width: 95% !important;
    margin: 5vh auto !important;
  }

  :deep(.el-dialog__body) {
    padding: 15px;
  }

  /* 上传区域优化 */
  :deep(.el-upload-dragger) {
    padding: 30px 15px;
  }

  :deep(.el-icon--upload) {
    font-size: 36px !important;
  }

  /* 编辑器优化 */
  .code-editor :deep(textarea) {
    font-size: 12px;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
    gap: 6px;
  }

  .file-icon {
    font-size: 28px;
  }

  .file-name {
    font-size: 10px;
  }

  .action-buttons .el-button {
    font-size: 11px;
    padding: 6px 8px;
  }
}
</style>
