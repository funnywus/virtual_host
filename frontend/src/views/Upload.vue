<template>
  <div class="upload-page">
    <!-- 授权码验证页面 -->
    <div v-if="!authorized" class="auth-container">
      <div class="auth-box">
        <div class="auth-logo">📁</div>
        <h2 class="auth-title">文件上传系统</h2>
        <p class="auth-subtitle">请输入授权码访问您的文件空间</p>
        <el-input v-model="authCode" placeholder="请输入授权码" size="large" @keyup.enter="verifyAuth" style="margin-bottom:20px">
          <template #prefix><el-icon><Key /></el-icon></template>
        </el-input>
        <el-button type="primary" size="large" @click="verifyAuth" :loading="verifying" style="width:100%;height:48px;font-size:16px">
          验证并进入
        </el-button>
        <p style="margin-top:20px;color:#909399;font-size:12px">如没有授权码，请联系管理员获取</p>
      </div>
      <div class="auth-contact" @click="showContactDialog = true">
        <el-icon><Service /></el-icon>
        <span>联系客服</span>
      </div>
    </div>

    <!-- 文件管理页面 -->
    <div v-else class="main-container">
      <div class="header">
        <div class="header-left">
          <span class="domain-info">{{ domain }}</span>
          <el-tag type="success" size="small">已连接</el-tag>
        </div>
        <div class="header-actions">
          <el-button @click="showContactDialog = true" type="success"><el-icon style="margin-right:5px"><Service /></el-icon> 联系客服</el-button>
          <el-button @click="showTutorialDialog = true"><el-icon style="margin-right:5px"><QuestionFilled /></el-icon> 帮助中心</el-button>
          <el-button @click="openWebsite"><el-icon style="margin-right:5px"><Link /></el-icon> 访问网站</el-button>
          <el-button @click="logout">退出</el-button>
        </div>
      </div>

      <!-- 续费提醒 -->
      <div v-if="showRenewAlert" class="renew-alert">
        <el-alert :type="isExpired ? 'error' : 'warning'" :closable="false" show-icon>
          <template #title>
            <span v-if="isExpired">您的服务已过期，请联系客服续费！</span>
            <span v-else>您的服务还剩 {{ remainingDays }} 天到期，请及时联系客服续费</span>
          </template>
        </el-alert>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">{{ files.filter(f => f.type === 'file').length }}</div>
          <div class="stat-label">文件数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ files.filter(f => f.type === 'directory').length }}</div>
          <div class="stat-label">文件夹数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" :style="{color: usedSize > maxUploadSize * 0.9 ? '#f56c6c' : '#409eff'}">{{ formatSize(usedSize) }}</div>
          <div class="stat-label">已用空间</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#67c23a">{{ formatSize(Math.max(0, maxUploadSize - usedSize)) }}</div>
          <div class="stat-label">剩余空间</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" :style="{color: remainingDays !== null && remainingDays <= 3 ? (remainingDays <= 0 ? '#f56c6c' : '#e6a23c') : '#67c23a'}">
            {{ remainingDays !== null ? (remainingDays <= 0 ? '已过期' : remainingDays + ' 天') : '永久' }}
          </div>
          <div class="stat-label">剩余时间</div>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="breadcrumb">
            <span class="breadcrumb-item" @click="navigateTo('')"><el-icon style="vertical-align:middle"><HomeFilled /></el-icon> 根目录</span>
            <span v-for="(part, index) in pathParts" :key="index" class="breadcrumb-part">
              <span class="breadcrumb-sep">/</span>
              <span class="breadcrumb-item" @click="navigateTo(pathParts.slice(0, index + 1).join('/'))">{{ part }}</span>
            </span>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <template v-if="selectedFiles.length > 0">
              <span style="color:#909399;font-size:13px">已选 {{ selectedFiles.length }} 项</span>
              <el-button type="danger" size="small" @click="deleteSelected"><el-icon style="margin-right:5px"><Delete /></el-icon>删除</el-button>
              <el-button size="small" @click="clearSelection">取消选择</el-button>
              <el-divider direction="vertical" />
            </template>
            <el-radio-group v-model="viewMode" size="small">
              <el-radio-button value="list"><el-icon><List /></el-icon></el-radio-button>
              <el-radio-button value="grid"><el-icon><Grid /></el-icon></el-radio-button>
            </el-radio-group>
            <el-button type="primary" @click="showUploadDialog = true"><el-icon style="margin-right:5px"><Upload /></el-icon> 上传文件</el-button>
            <el-button @click="showMkdirDialog = true"><el-icon style="margin-right:5px"><FolderAdd /></el-icon> 新建文件夹</el-button>
            <el-button @click="showNewFileDialog = true"><el-icon style="margin-right:5px"><Document /></el-icon> 新建文件</el-button>
            <el-button @click="loadFiles" :loading="loading"><el-icon style="margin-right:5px"><Refresh /></el-icon> 刷新</el-button>
          </div>
        </div>

        <div class="file-list" v-loading="loading">
          <!-- 列表视图 -->
          <template v-if="viewMode === 'list'">
            <div v-if="currentPath" class="file-item" @click="goBack">
              <div class="file-checkbox"></div>
              <div class="file-icon">📁</div>
              <div class="file-info"><div class="file-name">..</div><div class="file-meta">返回上级目录</div></div>
            </div>
            <div v-for="file in files" :key="file.name" class="file-item" 
                 :class="{ selected: isSelected(file) }"
                 @click="handleFileClick($event, file)">
              <div class="file-checkbox" @click.stop>
                <el-checkbox :model-value="isSelected(file)" @change="toggleSelect(file)" />
              </div>
              <div class="file-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</div>
              <div class="file-info">
                <div class="file-name">{{ file.name }}</div>
                <div class="file-meta"><span v-if="file.type === 'file'">{{ formatSize(file.size) }}</span></div>
              </div>
              <div class="file-date">{{ formatDate(file.date) }}</div>
              <div class="file-actions" @click.stop>
                <el-button v-if="file.type === 'file'" type="primary" size="small" @click="openFileUrl(file)" style="margin-right:8px">访问</el-button>
                <el-dropdown trigger="click">
                  <el-button size="small">操作<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="file.type === 'file'" @click="openFileUrl(file)">
                        <el-icon><Link /></el-icon>访问地址
                      </el-dropdown-item>
                      <el-dropdown-item v-if="file.type === 'file' && isEditableFile(file.name)" @click="openFile(file)">
                        <el-icon><Edit /></el-icon>编辑
                      </el-dropdown-item>
                      <el-dropdown-item v-if="file.type === 'file' && isPreviewableFile(file.name)" @click="previewFile(file)">
                        <el-icon><View /></el-icon>预览
                      </el-dropdown-item>
                      <el-dropdown-item @click="openRenameDialog(file)">
                        <el-icon><EditPen /></el-icon>重命名
                      </el-dropdown-item>
                      <el-dropdown-item divided @click="deleteFile(file)" style="color:#f56c6c">
                        <el-icon><Delete /></el-icon>删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>

          <!-- 网格视图 -->
          <template v-else>
            <div class="file-grid">
              <div v-if="currentPath" class="grid-item" @click="goBack">
                <div class="grid-icon">📁</div>
                <div class="grid-name">..</div>
              </div>
              <div v-for="file in files" :key="file.name" class="grid-item" 
                   :class="{ selected: isSelected(file) }"
                   @click="handleGridClick($event, file)"
                   @contextmenu.prevent="showContextMenu($event, file)">
                <div class="grid-checkbox" @click.stop>
                  <el-checkbox :model-value="isSelected(file)" @change="toggleSelect(file)" />
                </div>
                <div class="grid-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</div>
                <div class="grid-name" :title="file.name">{{ file.name }}</div>
                <el-dropdown trigger="click" class="grid-more" @click.stop>
                  <el-button size="small" circle @click.stop><el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="file.type === 'file'" @click="openFileUrl(file)">
                        <el-icon><Link /></el-icon>访问地址
                      </el-dropdown-item>
                      <el-dropdown-item v-if="file.type === 'file' && isEditableFile(file.name)" @click="openFile(file)">
                        <el-icon><Edit /></el-icon>编辑
                      </el-dropdown-item>
                      <el-dropdown-item v-if="file.type === 'file' && isPreviewableFile(file.name)" @click="previewFile(file)">
                        <el-icon><View /></el-icon>预览
                      </el-dropdown-item>
                      <el-dropdown-item @click="openRenameDialog(file)">
                        <el-icon><EditPen /></el-icon>重命名
                      </el-dropdown-item>
                      <el-dropdown-item divided @click="deleteFile(file)" style="color:#f56c6c">
                        <el-icon><Delete /></el-icon>删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>

          <div v-if="!loading && files.length === 0" class="empty-tip">
            <div class="empty-icon">📂</div>
            <p style="font-size:16px;margin-bottom:10px">当前目录为空</p>
            <p>点击上方按钮上传文件或创建文件夹</p>
            <div class="quick-actions">
              <el-button type="primary" @click="showUploadDialog = true">上传文件</el-button>
              <el-button @click="showMkdirDialog = true">新建文件夹</el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="footer">文件上传系统</div>

      <!-- 上传对话框 -->
      <el-dialog v-model="showUploadDialog" title="上传文件/文件夹" width="600px" :fullscreen="isMobile">
        <div class="upload-area" :class="{ dragover: isDragover }" @dragover.prevent="isDragover = true" @dragleave="isDragover = false" @drop.prevent="handleDrop">
          <div class="upload-icon">📤</div>
          <div class="upload-text">拖拽文件或文件夹到此处</div>
          <div class="upload-or">或</div>
          <el-dropdown trigger="click" @command="handleUploadCommand">
            <el-button type="primary" size="large">
              点击选择上传 <el-icon style="margin-left:5px"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="file"><el-icon><Document /></el-icon> 选择文件</el-dropdown-item>
                <el-dropdown-item command="folder"><el-icon><Folder /></el-icon> 选择文件夹</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <div class="upload-hint">💾 剩余空间 {{ formatSize(Math.max(0, maxUploadSize - usedSize)) }}</div>
          <input ref="fileInputRef" type="file" multiple hidden @change="handleFileSelect">
          <input ref="folderInputRef" type="file" webkitdirectory hidden @change="handleFolderSelect">
        </div>
        <div v-if="uploadQueue.length > 0" style="margin-top:20px">
          <div style="margin-bottom:10px;color:#606266;display:flex;justify-content:space-between;align-items:center">
            <span>待上传 ({{ uploadQueue.length }} 个文件，共 {{ formatSize(uploadQueue.reduce((s,f) => s + f.file.size, 0)) }})</span>
            <el-button type="danger" size="small" text @click="uploadQueue = []">清空列表</el-button>
          </div>
          <div style="max-height:250px;overflow-y:auto">
            <div v-for="(item, index) in uploadQueue" :key="index" style="display:flex;align-items:center;padding:10px;background:#fafafa;border-radius:6px;margin-bottom:8px">
              <span style="font-size:20px;margin-right:10px">{{ getFileIcon(item.name) }}</span>
              <div style="flex:1;overflow:hidden;min-width:0">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">{{ item.name }}</div>
                <div v-if="item.relativePath" style="font-size:11px;color:#909399;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.relativePath }}</div>
              </div>
              <span style="color:#909399;font-size:12px;margin:0 10px;white-space:nowrap">{{ formatSize(item.file.size) }}</span>
              <div v-if="item.status === 'uploading'" style="flex:1;max-width:150px;margin:0 10px">
                <el-progress :percentage="item.progress || 0" :stroke-width="6" :show-text="false" />
              </div>
              <el-tag :type="item.status === 'done' ? 'success' : item.status === 'error' ? 'danger' : item.status === 'uploading' ? 'warning' : 'info'" size="small">
                {{ item.status === 'done' ? '完成' : item.status === 'error' ? '失败' : item.status === 'uploading' ? (item.progress || 0) + '%' : '等待' }}
              </el-tag>
              <el-button v-if="item.status === 'pending'" type="danger" size="small" text @click="uploadQueue.splice(index, 1)" style="margin-left:5px"><el-icon><Close /></el-icon></el-button>
            </div>
          </div>
        </div>
        <template #footer>
          <el-button @click="showUploadDialog = false; uploadQueue = []">关闭</el-button>
          <el-button type="primary" @click="startUpload" :loading="uploading" :disabled="uploadQueue.filter(f => f.status === 'pending').length === 0">
            开始上传 ({{ uploadQueue.filter(f => f.status === 'pending').length }})
          </el-button>
        </template>
      </el-dialog>

      <!-- 新建文件夹对话框 -->
      <el-dialog v-model="showMkdirDialog" title="新建文件夹" width="400px" :fullscreen="isMobile">
        <el-input v-model="newFolderName" placeholder="请输入文件夹名称" size="large" @keyup.enter="createFolder">
          <template #prefix><el-icon><Folder /></el-icon></template>
        </el-input>
        <template #footer>
          <el-button @click="showMkdirDialog = false">取消</el-button>
          <el-button type="primary" @click="createFolder" :loading="creating">创建</el-button>
        </template>
      </el-dialog>

      <!-- 新建文件对话框 -->
      <el-dialog v-model="showNewFileDialog" title="新建文件" width="500px" :fullscreen="isMobile">
        <el-form label-width="80px">
          <el-form-item label="文件名">
            <el-input v-model="newFileName" placeholder="例如: index.html" size="large">
              <template #prefix><el-icon><Document /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item label="文件内容">
            <el-input v-model="newFileContent" type="textarea" :rows="8" placeholder="可选，留空创建空文件" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showNewFileDialog = false">取消</el-button>
          <el-button type="primary" @click="createFile" :loading="creatingFile">创建</el-button>
        </template>
      </el-dialog>

      <!-- 重命名对话框 -->
      <el-dialog v-model="showRenameDialog" title="重命名" width="400px" :fullscreen="isMobile">
        <el-input v-model="newFileName" placeholder="请输入新名称" size="large" @keyup.enter="renameFile">
          <template #prefix><el-icon><EditPen /></el-icon></template>
        </el-input>
        <template #footer>
          <el-button @click="showRenameDialog = false">取消</el-button>
          <el-button type="primary" @click="renameFile" :loading="renaming">确定</el-button>
        </template>
      </el-dialog>

      <!-- 文件编辑对话框 -->
      <el-dialog v-model="showEditDialog" :title="'编辑文件: ' + editingFile?.name" width="900px" top="5vh" :close-on-click-modal="false" :fullscreen="isMobile">
        <div v-loading="loadingFile" class="editor-container">
          <VueMonacoEditor
            v-model:value="fileContent"
            :language="getMonacoLanguage(editingFile?.name)"
            theme="vs-dark"
            :options="{ 
              fontSize: 14, 
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true
            }"
            style="height: 500px"
          />
        </div>
        <template #footer>
          <el-button @click="showEditDialog = false">取消</el-button>
          <el-button type="primary" @click="saveFile" :loading="savingFile">保存</el-button>
        </template>
      </el-dialog>

      <!-- 图片预览对话框 -->
      <el-dialog v-model="showPreviewDialog" :title="'预览: ' + previewingFile?.name" width="auto" top="5vh" :fullscreen="isMobile">
        <div style="text-align:center;max-height:80vh;overflow:auto">
          <img v-if="previewType === 'image'" :src="previewUrl" style="max-width:100%;max-height:75vh" />
        </div>
      </el-dialog>

      <!-- 使用教程对话框 -->
      <el-dialog v-model="showTutorialDialog" title="📖 帮助中心" width="650px" :fullscreen="isMobile">
        <div class="help-layout">
          <div class="help-left">
            <el-icon class="help-icon-el"><Upload /></el-icon>
            <h3>快捷上传</h3>
            <p>拖拽文件夹即可一键上传整个网站</p>
            <el-button type="primary" @click="showTutorialDialog = false; showUploadDialog = true" style="margin-top:15px">
              <el-icon style="margin-right:5px"><Upload /></el-icon>立即上传
            </el-button>
          </div>
          <div class="help-right">
            <div class="help-step">
              <div class="help-step-num">1</div>
              <div class="help-step-text">准备网站文件，<strong style="color:#f56c6c">首页文件名必须是 index.html</strong>（注意是小写）</div>
            </div>
            <div class="help-step">
              <div class="help-step-num">2</div>
              <div class="help-step-text">将文件或文件夹拖拽到上传区域</div>
            </div>
            <div class="help-step">
              <div class="help-step-num">3</div>
              <div class="help-step-text">确认文件列表后点击上传</div>
            </div>
            <div class="help-step">
              <div class="help-step-num">4</div>
              <div class="help-step-text">上传完成后点击"访问网站"查看效果</div>
            </div>
            <div class="help-tip">
              <el-icon><InfoFilled /></el-icon>
              <span><strong style="white-space:nowrap">重要：</strong>首页文件名必须是 index.html，否则网站无法正常访问！</span>
            </div>
            <div class="help-tip" style="background:#fef0f0;color:#f56c6c">
              <el-icon><InfoFilled /></el-icon>
              支持 HTML、CSS、JS、图片等常见文件
            </div>
          </div>
        </div>
      </el-dialog>

      <!-- 快捷上传教程对话框 -->
      <el-dialog v-model="showQuickTutorial" title="🚀 快捷上传教程" width="550px" :fullscreen="isMobile">
        <div class="quick-tutorial">
          <div class="quick-header">
            <div class="quick-icon">📂</div>
            <div class="quick-intro">
              <h3>一键上传整个网站</h3>
              <p>只需拖拽文件夹，系统自动保持目录结构</p>
            </div>
          </div>
          <div class="quick-steps">
            <div class="quick-step">
              <div class="quick-step-num">1</div>
              <div class="quick-step-content">
                <div class="quick-step-title">准备网站文件</div>
                <div class="quick-step-desc"><strong style="color:#f56c6c">首页文件名必须是 index.html</strong>（注意是小写），这是网站入口</div>
              </div>
            </div>
            <div class="quick-step">
              <div class="quick-step-num">2</div>
              <div class="quick-step-content">
                <div class="quick-step-title">拖拽上传</div>
                <div class="quick-step-desc">将整个文件夹直接拖到上传区域</div>
              </div>
            </div>
            <div class="quick-step">
              <div class="quick-step-num">3</div>
              <div class="quick-step-content">
                <div class="quick-step-title">点击开始上传</div>
                <div class="quick-step-desc">确认文件列表后点击上传按钮</div>
              </div>
            </div>
            <div class="quick-step">
              <div class="quick-step-num">4</div>
              <div class="quick-step-content">
                <div class="quick-step-title">访问网站</div>
                <div class="quick-step-desc">上传完成后点击"访问网站"查看效果</div>
              </div>
            </div>
          </div>
          <div class="quick-tip" style="background:#fef0f0;color:#f56c6c">
            <el-icon><InfoFilled /></el-icon>
            <span><strong style="white-space:nowrap">重要：</strong>首页文件名必须是 index.html，否则网站无法正常访问！</span>
          </div>
          <div class="quick-tip">
            <el-icon><InfoFilled /></el-icon>
            <span>支持的文件类型包括 HTML、CSS、JS、图片等常见网页文件</span>
          </div>
        </div>
        <template #footer>
          <el-button @click="showQuickTutorial = false">关闭</el-button>
          <el-button type="primary" @click="showQuickTutorial = false; showUploadDialog = true">
            <el-icon style="margin-right:5px"><Upload /></el-icon>立即上传
          </el-button>
        </template>
      </el-dialog>
    </div>

    <!-- 联系客服对话框（放在外层，授权页面也能访问） -->
    <el-dialog v-model="showContactDialog" title="💬 联系客服" width="500px" :fullscreen="isMobile">
      <div class="contact-content">
        <div class="contact-layout">
          <div class="contact-left">
            <div class="qrcode-box">
              <img src="/wechat-qrcode.png" alt="微信二维码" class="qrcode-img" />
              <p class="qrcode-tip">微信扫码添加</p>
            </div>
          </div>
          <div class="contact-right">
            <div class="contact-icon">💁‍♀️</div>
            <h3 class="contact-title">添加客服微信</h3>
            <p class="contact-desc">如有任何问题，欢迎添加客服微信咨询</p>
            <div class="wechat-info">
              <div class="wechat-label">微信号</div>
              <div class="wechat-id">feiyu3305</div>
            </div>
            <el-button type="success" @click="copyWechat" style="width:100%">
              <el-icon style="margin-right:5px"><DocumentCopy /></el-icon>复制微信号
            </el-button>
            <p class="service-time">服务时间：周一至周日 9:00-22:00</p>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Link, HomeFilled, Upload, FolderAdd, Refresh, Delete, Close, Edit, View, ArrowDown, Document, Folder, QuestionFilled, Service, DocumentCopy, InfoFilled, Star, Promotion, EditPen, List, Grid, MoreFilled } from '@element-plus/icons-vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'

const authCode = ref(localStorage.getItem('upload_auth_code') || '')
const authorized = ref(false)
const verifying = ref(false)
const domain = ref('')
const homeDir = ref('')
const maxUploadSize = ref(209715200)
const usedSize = ref(0)
const expireAt = ref(null)
const remainingDays = ref(null)
const windowWidth = ref(window.innerWidth)
const isMobile = computed(() => windowWidth.value < 768)

const currentPath = ref('')
const files = ref([])
const loading = ref(false)
const viewMode = ref('list')

// 多选相关
const selectedFiles = ref([])

const isSelected = (file) => {
  return selectedFiles.value.some(f => f.name === file.name)
}

const toggleSelect = (file) => {
  const index = selectedFiles.value.findIndex(f => f.name === file.name)
  if (index > -1) {
    selectedFiles.value.splice(index, 1)
  } else {
    selectedFiles.value.push(file)
  }
}

const clearSelection = () => {
  selectedFiles.value = []
}

const handleFileClick = (event, file) => {
  // Ctrl/Cmd + 点击 多选
  if (event.ctrlKey || event.metaKey) {
    toggleSelect(file)
    return
  }
  // 普通点击
  if (file.type === 'directory') {
    navigateTo(currentPath.value ? currentPath.value + '/' + file.name : file.name)
  } else {
    // 单击文件时，如果已有选中则切换选中状态，否则打开文件
    if (selectedFiles.value.length > 0) {
      toggleSelect(file)
    }
  }
}

const handleGridClick = (event, file) => {
  // Ctrl/Cmd + 点击 多选
  if (event.ctrlKey || event.metaKey) {
    toggleSelect(file)
    return
  }
  // 普通点击
  if (file.type === 'directory') {
    navigateTo(currentPath.value ? currentPath.value + '/' + file.name : file.name)
  } else {
    // 单击文件时，如果已有选中则切换选中状态
    if (selectedFiles.value.length > 0) {
      toggleSelect(file)
    }
  }
}

const deleteSelected = async () => {
  if (selectedFiles.value.length === 0) return
  try {
    const hasDir = selectedFiles.value.some(f => f.type === 'directory')
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedFiles.value.length} 个项目？${hasDir ? '文件夹内所有内容将被删除！' : ''}`,
      '批量删除',
      { type: 'warning' }
    )
    let success = 0, failed = 0
    for (const file of selectedFiles.value) {
      try {
        const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
        await api('/delete', { path: filePath })
        success++
      } catch (e) {
        failed++
      }
    }
    if (failed === 0) {
      ElMessage.success(`成功删除 ${success} 个项目`)
    } else {
      ElMessage.warning(`删除完成: 成功 ${success} 个, 失败 ${failed} 个`)
    }
    selectedFiles.value = []
    loadFiles()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message)
  }
}

// 文件编辑相关
const showEditDialog = ref(false)
const editingFile = ref(null)
const fileContent = ref('')
const loadingFile = ref(false)
const savingFile = ref(false)

// 文件预览相关
const showPreviewDialog = ref(false)
const previewingFile = ref(null)
const previewUrl = ref('')
const previewType = ref('')

// 可编辑的文件类型
const editableExts = ['txt', 'html', 'htm', 'css', 'js', 'json', 'xml', 'md', 'php', 'py', 'sh', 'sql', 'vue', 'jsx', 'ts', 'tsx', 'yaml', 'yml', 'conf', 'ini', 'log', 'htaccess']
const isEditableFile = (name) => {
  const ext = name.split('.').pop().toLowerCase()
  return editableExts.includes(ext)
}

// 可预览的文件类型（图片）
const previewableExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp']
const isPreviewableFile = (name) => {
  const ext = name.split('.').pop().toLowerCase()
  return previewableExts.includes(ext)
}

// 根据文件类型获取Monaco语言
const getMonacoLanguage = (filename) => {
  const ext = filename?.split('.').pop().toLowerCase() || ''
  const langMap = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    html: 'html', htm: 'html', vue: 'html',
    css: 'css', scss: 'scss', less: 'less',
    json: 'json',
    php: 'php',
    py: 'python',
    sql: 'sql',
    xml: 'xml',
    md: 'markdown',
    sh: 'shell',
    yaml: 'yaml', yml: 'yaml',
    txt: 'plaintext'
  }
  return langMap[ext] || 'plaintext'
}

// 计算是否即将过期（3天内）
const isExpiringSoon = computed(() => {
  if (remainingDays.value === null) return false
  return remainingDays.value > 0 && remainingDays.value <= 3
})

// 计算是否已过期
const isExpired = computed(() => {
  if (remainingDays.value === null) return false
  return remainingDays.value <= 0
})

// 是否显示续费提醒
const showRenewAlert = computed(() => isExpiringSoon.value || isExpired.value)

const showUploadDialog = ref(false)
const showMkdirDialog = ref(false)
const showNewFileDialog = ref(false)
const newFileName = ref('')
const newFileContent = ref('')
const creatingFile = ref(false)
const showTutorialDialog = ref(false)
const showQuickTutorial = ref(false)
const showContactDialog = ref(false)
const showRenameDialog = ref(false)
const renamingFile = ref(null)
const renaming = ref(false)
const uploadQueue = ref([])
const uploading = ref(false)
const isDragover = ref(false)
const newFolderName = ref('')
const creating = ref(false)

const fileInputRef = ref(null)
const folderInputRef = ref(null)

const pathParts = computed(() => currentPath.value ? currentPath.value.split('/').filter(p => p) : [])

const api = async (url, data = {}) => {
  const res = await fetch(`/api/upload${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: authCode.value, ...data })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error)
  return json
}

const verifyAuth = async () => {
  if (!authCode.value) { ElMessage.warning('请输入授权码'); return }
  verifying.value = true
  try {
    const res = await api('/auth')
    domain.value = res.domain
    homeDir.value = res.home_dir
    maxUploadSize.value = res.max_upload_size || 209715200
    expireAt.value = res.expire_at || null
    remainingDays.value = res.remaining_days
    authorized.value = true
    localStorage.setItem('upload_auth_code', authCode.value)
    loadFiles()
  } catch (e) { ElMessage.error(e.message) }
  finally { verifying.value = false }
}

const logout = () => { authorized.value = false; authCode.value = ''; localStorage.removeItem('upload_auth_code') }
const openWebsite = () => window.open(`http://${domain.value}`, '_blank')
const openFileUrl = (file) => {
  const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
  window.open(`http://${domain.value}/${filePath}`, '_blank')
}
const copyWechat = () => {
  navigator.clipboard.writeText('feiyu3305')
  ElMessage.success('微信号已复制')
}

const loadFiles = async () => {
  loading.value = true
  try {
    const res = await api('/list', { path: currentPath.value })
    files.value = res.files.sort((a, b) => { if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; return a.name.localeCompare(b.name) })
    const usage = await api('/usage')
    usedSize.value = usage.used_size || 0
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

const navigateTo = (path) => { currentPath.value = path; selectedFiles.value = []; loadFiles() }
const goBack = () => { const parts = currentPath.value.split('/').filter(p => p); parts.pop(); currentPath.value = parts.join('/'); selectedFiles.value = []; loadFiles() }

const handleFileSelect = (e) => { addFilesToQueue(e.target.files, false); e.target.value = '' }
const handleFolderSelect = (e) => { addFilesToQueue(e.target.files, true); e.target.value = '' }
const handleUploadCommand = (cmd) => {
  if (cmd === 'file') fileInputRef.value?.click()
  else if (cmd === 'folder') folderInputRef.value?.click()
}

const addFilesToQueue = (fileList, keepPath = false) => {
  const newFiles = Array.from(fileList).map(f => {
    const relativePath = keepPath && f.webkitRelativePath ? f.webkitRelativePath : f.name
    return { file: f, name: f.name, relativePath: relativePath !== f.name ? relativePath : '', uploadPath: relativePath, status: 'pending', progress: 0 }
  })
  uploadQueue.value.push(...newFiles)
}

const handleDrop = async (e) => {
  isDragover.value = false
  const items = e.dataTransfer.items
  const filesList = []
  const readEntry = async (entry, path = '') => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file(file => {
          const relativePath = path ? path + '/' + file.name : file.name
          filesList.push({ file, name: file.name, relativePath: path ? relativePath : '', uploadPath: relativePath, status: 'pending' })
          resolve()
        })
      })
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader()
      return new Promise((resolve) => {
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) { resolve() }
            else { for (const ent of entries) { await readEntry(ent, path ? path + '/' + entry.name : entry.name) }; readEntries() }
          })
        }
        readEntries()
      })
    }
  }
  const promises = []
  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
    if (entry) { promises.push(readEntry(entry)) }
    else if (item.kind === 'file') { const file = item.getAsFile(); if (file) filesList.push({ file, name: file.name, relativePath: '', uploadPath: file.name, status: 'pending' }) }
  }
  await Promise.all(promises)
  uploadQueue.value.push(...filesList)
}

const startUpload = async () => {
  const totalUploadSize = uploadQueue.value.filter(f => f.status === 'pending').reduce((sum, f) => sum + f.file.size, 0)
  const remaining = maxUploadSize.value - usedSize.value
  if (totalUploadSize > remaining) { ElMessage.error(`空间不足！待上传 ${formatSize(totalUploadSize)}，剩余 ${formatSize(remaining)}`); return }
  uploading.value = true
  for (const item of uploadQueue.value) {
    if (item.status !== 'pending') continue
    item.status = 'uploading'
    item.progress = 0
    try {
      let uploadDir = currentPath.value
      const filePath = item.uploadPath || item.name
      const pathParts = filePath.split('/')
      const fileName = pathParts.pop()
      if (pathParts.length > 0) uploadDir = currentPath.value ? currentPath.value + '/' + pathParts.join('/') : pathParts.join('/')
      
      // 使用 FormData 上传
      const formData = new FormData()
      formData.append('auth_code', authCode.value)
      formData.append('path', uploadDir)
      formData.append('filename', fileName)
      formData.append('file', item.file)
      
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            item.progress = Math.round((e.loaded / e.total) * 100)
          }
        })
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const res = JSON.parse(xhr.responseText)
            if (res.error) reject(new Error(res.error))
            else resolve(res)
          } else {
            reject(new Error('上传失败'))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('网络错误')))
        xhr.addEventListener('abort', () => reject(new Error('上传取消')))
        xhr.open('POST', '/api/upload/upload-file')
        xhr.send(formData)
      })
      
      item.status = 'done'
      item.progress = 100
      usedSize.value += item.file.size
    } catch (e) { 
      item.status = 'error'
      console.error('Upload error:', e)
    }
  }
  uploading.value = false
  loadFiles()
  const success = uploadQueue.value.filter(f => f.status === 'done').length
  const failed = uploadQueue.value.filter(f => f.status === 'error').length
  if (failed === 0) ElMessage.success(`上传完成，共${success}个文件`)
  else ElMessage.warning(`上传完成: 成功${success}个, 失败${failed}个`)
}

const fileToBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })

const createFolder = async () => {
  if (!newFolderName.value) { ElMessage.warning('请输入文件夹名称'); return }
  creating.value = true
  try { await api('/mkdir', { path: currentPath.value, name: newFolderName.value }); ElMessage.success('创建成功'); showMkdirDialog.value = false; newFolderName.value = ''; loadFiles() }
  catch (e) { ElMessage.error(e.message) }
  finally { creating.value = false }
}

const createFile = async () => {
  if (!newFileName.value) { ElMessage.warning('请输入文件名'); return }
  creatingFile.value = true
  try {
    await api('/create-file', { path: currentPath.value, name: newFileName.value, content: newFileContent.value || '' })
    ElMessage.success('创建成功')
    showNewFileDialog.value = false
    newFileName.value = ''
    newFileContent.value = ''
    loadFiles()
  } catch (e) { ElMessage.error(e.message) }
  finally { creatingFile.value = false }
}

const deleteFile = async (file) => {
  try {
    await ElMessageBox.confirm(`确定删除 "${file.name}"？${file.type === 'directory' ? '文件夹内所有内容将被删除！' : ''}`, '确认删除', { type: 'warning' })
    const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    await api('/delete', { path: filePath })
    ElMessage.success('删除成功')
    loadFiles()
  } catch (e) { if (e !== 'cancel') ElMessage.error(e.message) }
}

// 重命名
const openRenameDialog = (file) => {
  renamingFile.value = file
  newFileName.value = file.name
  showRenameDialog.value = true
}

const renameFile = async () => {
  if (!newFileName.value.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  if (newFileName.value === renamingFile.value.name) {
    showRenameDialog.value = false
    return
  }
  renaming.value = true
  try {
    const oldPath = currentPath.value ? `${currentPath.value}/${renamingFile.value.name}` : renamingFile.value.name
    const newPath = currentPath.value ? `${currentPath.value}/${newFileName.value}` : newFileName.value
    await api('/rename', { oldPath, newPath })
    ElMessage.success('重命名成功')
    showRenameDialog.value = false
    loadFiles()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 打开文件编辑
const openFile = async (file) => {
  if (!isEditableFile(file.name)) {
    ElMessage.warning('该文件类型不支持编辑')
    return
  }
  editingFile.value = file
  fileContent.value = ''
  showEditDialog.value = true
  loadingFile.value = true
  try {
    const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    const res = await api('/read', { path: filePath })
    fileContent.value = res.content || ''
  } catch (e) {
    ElMessage.error('读取文件失败: ' + e.message)
    showEditDialog.value = false
  } finally {
    loadingFile.value = false
  }
}

// 保存文件
const saveFile = async () => {
  if (!editingFile.value) return
  savingFile.value = true
  try {
    const filePath = currentPath.value ? `${currentPath.value}/${editingFile.value.name}` : editingFile.value.name
    await api('/write', { path: filePath, content: fileContent.value })
    ElMessage.success('保存成功')
    showEditDialog.value = false
    loadFiles()
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    savingFile.value = false
  }
}

// 预览图片
const previewFile = async (file) => {
  if (!isPreviewableFile(file.name)) return
  previewingFile.value = file
  previewType.value = 'image'
  const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
  // 通过接口获取图片base64
  try {
    const res = await api('/read-binary', { path: filePath })
    const ext = file.name.split('.').pop().toLowerCase()
    const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' }
    previewUrl.value = `data:${mimeTypes[ext] || 'image/png'};base64,${res.content}`
    showPreviewDialog.value = true
  } catch (e) {
    ElMessage.error('预览失败: ' + e.message)
  }
}

const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

const getFileIcon = (name) => {
  const ext = name.split('.').pop().toLowerCase()
  const icons = { 'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️', 'webp': '🖼️', 'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'mp3': '🎵', 'wav': '🎵', 'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗', 'zip': '📦', 'rar': '📦', '7z': '📦', 'html': '🌐', 'css': '🎨', 'js': '📜', 'json': '📋', 'php': '🐘', 'py': '🐍', 'vue': '💚', 'txt': '📄', 'md': '📝', 'sql': '🗃️' }
  return icons[ext] || '📄'
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  // 解析各种日期格式
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}:${s}`
}

onMounted(() => {
  // 检查 URL 参数中的授权码
  const urlParams = new URLSearchParams(window.location.search)
  const codeFromUrl = urlParams.get('code')
  if (codeFromUrl) {
    authCode.value = codeFromUrl
    // 清除 URL 参数
    window.history.replaceState({}, '', window.location.pathname)
  }
  
  if (authCode.value) verifyAuth()
  
  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const handleResize = () => {
  windowWidth.value = window.innerWidth
}
</script>

<style scoped>
.upload-page { min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.auth-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; position: relative; }
.auth-box { width: 420px; padding: 50px 40px; background: #fff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
.auth-contact { position: fixed; bottom: 30px; right: 30px; background: #67c23a; color: #fff; padding: 12px 20px; border-radius: 25px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 15px rgba(103,194,58,0.4); transition: all 0.3s; }
.auth-contact:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(103,194,58,0.5); }
.auth-logo { font-size: 48px; margin-bottom: 10px; }
.auth-title { margin-bottom: 10px; color: #303133; font-size: 24px; }
.auth-subtitle { color: #909399; margin-bottom: 30px; font-size: 14px; }
.main-container { max-width: 1200px; margin: 0 auto; padding: 20px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 20px 25px; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
.header-left { display: flex; align-items: center; gap: 15px; }
.domain-info { font-size: 20px; font-weight: bold; color: #409eff; }
.header-actions { display: flex; gap: 10px; }
.stats-row { display: flex; gap: 15px; margin-bottom: 20px; }
.stat-card { flex: 1; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
.stat-value { font-size: 24px; font-weight: bold; color: #409eff; }
.stat-label { color: #909399; font-size: 14px; margin-top: 5px; }
.renew-alert { margin-bottom: 20px; }
.card { background: #fff; padding: 25px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #f0f0f0; }
.breadcrumb { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.breadcrumb-item { cursor: pointer; color: #409eff; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; }
.breadcrumb-item:hover { background: #ecf5ff; }
.breadcrumb-sep { color: #c0c4cc; }
.file-list { height: 350px; overflow-y: auto; overflow-x: hidden; }
.file-item { display: flex; align-items: center; padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; cursor: pointer; transition: background 0.2s; background: #fafafa; }
.file-item:hover { background: #ecf5ff; }
.file-item.selected { background: #e6f0ff; border: 1px solid #409eff; }
.file-checkbox { width: 30px; display: flex; align-items: center; justify-content: center; }
.file-icon { width: 30px; font-size: 18px; }
.file-info { flex: 1; }
.file-name { font-weight: 500; color: #303133; font-size: 13px; }
.file-meta { font-size: 11px; color: #909399; }
.file-date { font-size: 11px; color: #909399; margin-right: 15px; white-space: nowrap; }
.file-actions { transition: opacity 0.2s; }

/* 网格视图 */
.file-grid { display: grid; grid-template-columns: repeat(auto-fill, 100px); gap: 15px; padding: 10px 0; justify-content: center; }
.grid-item { position: relative; display: flex; flex-direction: column; align-items: center; padding: 15px 10px; border-radius: 8px; cursor: pointer; transition: background 0.2s; background: #fafafa; width: 100px; height: 100px; justify-content: center; }
.grid-item:hover { background: #ecf5ff; }
.grid-item.selected { background: #e6f0ff; border: 2px solid #409eff; }
.grid-checkbox { position: absolute; top: 5px; left: 5px; opacity: 0; transition: opacity 0.2s; }
.grid-item:hover .grid-checkbox, .grid-item.selected .grid-checkbox { opacity: 1; }
.grid-icon { font-size: 36px; margin-bottom: 6px; }
.grid-name { font-size: 12px; color: #303133; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 5px; }
.grid-more { position: absolute; top: 5px; right: 5px; opacity: 0; transition: opacity 0.2s; }
.grid-item:hover .grid-more { opacity: 1; }
.upload-area { border: 2px dashed #dcdfe6; border-radius: 12px; padding: 40px 30px; text-align: center; transition: all 0.3s; background: #fafafa; }
.upload-area:hover { border-color: #409eff; background: #ecf5ff; }
.upload-area.dragover { border-color: #409eff; background: #ecf5ff; transform: scale(1.02); }
.upload-icon { font-size: 48px; margin-bottom: 8px; }
.upload-text { color: #606266; font-size: 15px; margin-bottom: 8px; }
.upload-or { color: #c0c4cc; font-size: 13px; margin-bottom: 15px; }
.upload-hint { color: #909399; font-size: 13px; margin-top: 15px; }
.empty-tip { text-align: center; color: #909399; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.empty-icon { font-size: 48px; color: #dcdfe6; margin-bottom: 10px; }
.quick-actions { display: flex; gap: 10px; margin-top: 15px; justify-content: center; }
.footer { text-align: center; padding: 20px; color: rgba(255,255,255,0.7); font-size: 13px; }
.editor-container { border: 1px solid #dcdfe6; border-radius: 4px; overflow: hidden; }
.editor-container :deep(.cm-editor) { font-size: 14px; }
.editor-container :deep(.cm-scroller) { font-family: 'Fira Code', 'Monaco', 'Menlo', monospace; }
.tutorial-content { color: #606266; }
.tutorial-section { margin-bottom: 20px; }
.tutorial-section h4 { color: #303133; margin-bottom: 10px; font-size: 15px; }
.tutorial-section ol, .tutorial-section ul { padding-left: 20px; line-height: 2; }
.tutorial-section li { font-size: 14px; }
.highlight-section { background: linear-gradient(135deg, #ecf5ff 0%, #f0f9eb 100%); padding: 20px; border-radius: 8px; border-left: 4px solid #409eff; }
.highlight-section h4 { color: #409eff; font-size: 16px; }
.tip-box { background: #fff; padding: 12px 15px; border-radius: 6px; margin-top: 10px; font-size: 13px; color: #e6a23c; }
.contact-content { padding: 10px 0; }
.contact-layout { display: flex; gap: 30px; align-items: center; }
.contact-left { flex-shrink: 0; }
.qrcode-box { text-align: center; }
.qrcode-img { width: 180px; height: 180px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
.qrcode-tip { color: #909399; font-size: 12px; margin-top: 10px; }
.contact-right { flex: 1; text-align: center; }
.contact-icon { font-size: 48px; margin-bottom: 10px; }
.contact-title { color: #303133; margin-bottom: 8px; font-size: 18px; }
.contact-desc { color: #909399; font-size: 13px; margin-bottom: 20px; }
.wechat-info { background: linear-gradient(135deg, #07c160 0%, #06ad56 100%); padding: 15px 20px; border-radius: 10px; margin-bottom: 15px; }
.wechat-label { color: rgba(255,255,255,0.8); font-size: 12px; margin-bottom: 5px; }
.wechat-id { color: #fff; font-size: 22px; font-weight: bold; letter-spacing: 1px; }
.service-time { color: #909399; font-size: 12px; margin-top: 15px; }

/* 教程样式 */
.tutorial-content { color: #606266; }
.tutorial-highlight { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 25px; margin-bottom: 20px; color: #fff; }
.highlight-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.highlight-icon { font-size: 28px; }
.highlight-title { font-size: 18px; font-weight: 600; }
.highlight-steps { display: flex; flex-direction: column; gap: 12px; }
.step-item { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.15); padding: 12px 15px; border-radius: 8px; }
.step-num { width: 28px; height: 28px; background: #fff; color: #667eea; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; flex-shrink: 0; }
.step-text { font-size: 14px; }
.highlight-tip { display: flex; align-items: center; gap: 8px; margin-top: 15px; padding: 12px 15px; background: rgba(255,255,255,0.2); border-radius: 8px; font-size: 13px; }
.tutorial-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
.tutorial-card { background: #f8f9fa; border-radius: 10px; padding: 20px; transition: all 0.3s; }
.tutorial-card:hover { background: #ecf5ff; transform: translateY(-2px); }
.card-icon { font-size: 32px; margin-bottom: 10px; }
.card-title { font-size: 15px; font-weight: 600; color: #303133; margin-bottom: 10px; }
.card-list { padding-left: 18px; margin: 0; font-size: 13px; color: #606266; line-height: 1.8; }
.tutorial-tips { background: #fffbeb; border-radius: 10px; padding: 15px 20px; border: 1px solid #ffeeba; }
.tips-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #e6a23c; margin-bottom: 12px; }
.tips-list { display: flex; flex-wrap: wrap; gap: 10px; }
.tip-tag { background: #fff; padding: 6px 12px; border-radius: 15px; font-size: 12px; color: #e6a23c; border: 1px solid #ffeeba; }

/* 快捷上传教程样式 */
.quick-tutorial { padding: 10px 0; }
.quick-header { display: flex; align-items: center; gap: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: #fff; margin-bottom: 25px; }
.quick-icon { font-size: 50px; }
.quick-intro h3 { font-size: 20px; margin-bottom: 5px; }
.quick-intro p { font-size: 14px; opacity: 0.9; }
.quick-steps { display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px; }
.quick-step { display: flex; align-items: flex-start; gap: 15px; padding: 18px; background: #f8f9fa; border-radius: 10px; transition: all 0.3s; }
.quick-step:hover { background: #ecf5ff; transform: translateX(5px); }
.quick-step-num { width: 36px; height: 36px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; flex-shrink: 0; }
.quick-step-content { flex: 1; }
.quick-step-title { font-size: 15px; font-weight: 600; color: #303133; margin-bottom: 5px; }
.quick-step-desc { font-size: 13px; color: #909399; }
.quick-tip { display: flex; align-items: center; gap: 10px; padding: 15px; background: #ecf5ff; border-radius: 8px; color: #409eff; font-size: 13px; }

/* 帮助中心左右布局 */
.help-layout { display: flex; gap: 30px; }
.help-left { flex-shrink: 0; width: 180px; text-align: center; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: #fff; }
.help-icon-el { font-size: 50px; margin-bottom: 10px; }
.help-left h3 { font-size: 18px; margin-bottom: 8px; }
.help-left p { font-size: 12px; opacity: 0.9; line-height: 1.5; }
.help-right { flex: 1; display: flex; flex-direction: column; gap: 12px; }
.help-step { display: flex; align-items: center; gap: 12px; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; }
.help-step-num { width: 28px; height: 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; flex-shrink: 0; }
.help-step-text { font-size: 14px; color: #303133; }
.help-tip { display: flex; align-items: center; gap: 8px; padding: 12px 15px; background: #ecf5ff; border-radius: 8px; color: #409eff; font-size: 13px; margin-top: 5px; }

/* 手机端响应式 */
@media (max-width: 768px) {
  .main-container { padding: 10px; }
  
  .header { flex-direction: column; gap: 15px; padding: 15px; }
  .header-left { width: 100%; justify-content: center; }
  .header-actions { width: 100%; flex-wrap: wrap; justify-content: center; }
  .header-actions .el-button { flex: 1; min-width: 80px; padding: 8px 10px; font-size: 12px; }
  .header-actions .el-button .el-icon { margin-right: 3px !important; }
  .domain-info { font-size: 16px; }
  
  .stats-row { flex-wrap: wrap; gap: 10px; }
  .stat-card { flex: 1 1 45%; min-width: 140px; padding: 15px 10px; }
  .stat-value { font-size: 20px; }
  .stat-label { font-size: 12px; }
  
  .card { padding: 15px; }
  .toolbar { flex-direction: column; gap: 15px; align-items: stretch; }
  .toolbar > div { width: 100%; }
  .toolbar > div:last-child { display: flex; flex-wrap: wrap; gap: 8px; }
  .toolbar > div:last-child .el-button { flex: 1; min-width: 90px; }
  
  .file-item { padding: 12px 15px; }
  .file-icon { width: 40px; font-size: 26px; }
  .file-name { font-size: 14px; }
  .file-meta { font-size: 11px; }
  .file-actions { opacity: 1; display: flex; flex-wrap: wrap; gap: 5px; }
  .file-actions .el-button { padding: 5px 8px; font-size: 12px; }
  
  .auth-box { width: 95%; padding: 30px 20px; }
  .auth-logo { font-size: 40px; }
  .auth-title { font-size: 20px; }
  
  /* 对话框响应式 */
  .contact-layout { flex-direction: column; gap: 20px; }
  .qrcode-img { width: 150px; height: 150px; }
  
  .tutorial-cards { grid-template-columns: 1fr; }
  
  .quick-header { flex-direction: column; text-align: center; padding: 20px; }
  .quick-icon { font-size: 40px; }
  .quick-intro h3 { font-size: 18px; }
  .quick-step { padding: 15px; }
  .quick-step-num { width: 30px; height: 30px; font-size: 14px; }
  
  .help-layout { flex-direction: column; gap: 20px; }
  .help-left { width: 100%; }
  
  .upload-area { padding: 30px 15px; }
  .upload-icon { font-size: 36px; }
  
  .empty-tip { padding: 30px 0; }
  .empty-icon { font-size: 40px; }
  .quick-actions { flex-direction: column; }
}

@media (max-width: 480px) {
  .header-actions .el-button span { display: none; }
  .header-actions .el-button .el-icon { margin-right: 0 !important; }
  
  .stat-card { flex: 1 1 100%; }
  
  .tips-list { flex-direction: column; }
  .tip-tag { text-align: center; }
}
</style>
