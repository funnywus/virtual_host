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
      <div v-if="showRenewAlert" class="renew-alert-container">
        <div class="renew-alert-card" :class="{ 'expired': isExpired, 'warning': !isExpired }">
          <div class="renew-alert-icon">
            <el-icon v-if="isExpired" style="font-size:32px;color:#FF3B30"><WarningFilled /></el-icon>
            <el-icon v-else style="font-size:32px;color:#FF9500"><Clock /></el-icon>
          </div>
          <div class="renew-alert-content">
            <div class="renew-alert-title">
              <span v-if="isExpired">⚠️ 服务已过期</span>
              <span v-else>⏰ 服务即将到期</span>
            </div>
            <div class="renew-alert-message">
              <span v-if="isExpired">您的服务已过期，为避免影响使用，请尽快联系客服续费</span>
              <span v-else>您的服务还剩 <strong style="color:#FF9500;font-size:18px">{{ remainingDays }}</strong> 天到期，请及时续费</span>
            </div>
            <div class="renew-alert-info" v-if="expireAt">
              <span style="color:#86868B;font-size:13px">到期时间：{{ formatExpireDate(expireAt) }}</span>
            </div>
          </div>
          <div class="renew-alert-action">
            <el-button type="success" size="large" @click="showContactDialog = true" round>
              <el-icon style="margin-right:5px"><Service /></el-icon>
              立即续费
            </el-button>
          </div>
        </div>
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
          <div class="stat-value">{{ formatSize(usedSize) }}</div>
          <div class="stat-label">已用空间</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatSize(Math.max(0, maxUploadSize - usedSize)) }}</div>
          <div class="stat-label">剩余空间</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {{ remainingDays !== null ? (remainingDays <= 0 ? '已过期' : remainingDays + ' 天') : '永久' }}
          </div>
          <div class="stat-label">剩余时间</div>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-row">
            <div class="breadcrumb">
              <span class="breadcrumb-item" @click="navigateTo('')"><el-icon style="vertical-align:middle"><HomeFilled /></el-icon> 根目录</span>
              <span v-for="(part, index) in pathParts" :key="index" class="breadcrumb-part">
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-item" @click="navigateTo(pathParts.slice(0, index + 1).join('/'))">{{ part }}</span>
              </span>
            </div>
            <div class="toolbar-actions">
              <template v-if="files.length > 0">
                <el-button size="small" @click="selectAll" v-if="selectedFiles.length < files.length">全选</el-button>
                <el-button size="small" @click="clearSelection" v-else>取消全选</el-button>
              </template>
              <el-radio-group v-model="viewMode" size="small">
                <el-radio-button value="list"><el-icon><List /></el-icon></el-radio-button>
                <el-radio-button value="grid"><el-icon><Grid /></el-icon></el-radio-button>
              </el-radio-group>
              <el-button type="primary" @click="showUploadDialog = true"><el-icon style="margin-right:5px"><Upload /></el-icon> 上传文件</el-button>
              <el-button @click="showMkdirDialog = true"><el-icon style="margin-right:5px"><FolderAdd /></el-icon> 新建文件夹</el-button>
              <el-button @click="openNewFileDialog"><el-icon style="margin-right:5px"><Document /></el-icon> 新建文件</el-button>
              <el-tooltip content="刷新文件列表" placement="top">
                <el-button @click="loadFiles" :loading="loading" circle><el-icon><Refresh /></el-icon></el-button>
              </el-tooltip>
            </div>
          </div>
          
          <!-- 批量操作独占一行 -->
          <div v-if="selectedFiles.length > 0 || clipboard.files.length > 0" class="batch-operations">
            <template v-if="selectedFiles.length > 0">
              <span style="color:#606266;font-size:13px;font-weight:500">已选 {{ selectedFiles.length }} 项</span>
              <el-button type="primary" size="small" @click="copyFiles"><el-icon style="margin-right:5px"><DocumentCopy /></el-icon>复制</el-button>
              <el-button type="warning" size="small" @click="cutFiles"><el-icon style="margin-right:5px"><Scissor /></el-icon>剪切</el-button>
              <el-button type="success" size="small" @click="compressFiles"><el-icon style="margin-right:5px"><Files /></el-icon>压缩</el-button>
              <el-button type="danger" size="small" @click="deleteSelected"><el-icon style="margin-right:5px"><Delete /></el-icon>删除</el-button>
              <el-button size="small" @click="clearSelection">取消选择</el-button>
            </template>
            <template v-if="clipboard.files.length > 0">
              <el-divider v-if="selectedFiles.length > 0" direction="vertical" style="margin:0 10px" />
              <el-button type="success" size="small" @click="pasteFiles"><el-icon style="margin-right:5px"><DocumentCopy /></el-icon>粘贴 ({{ clipboard.files.length }})</el-button>
              <el-button size="small" text @click="clearClipboard">清空剪贴板</el-button>
            </template>
          </div>
        </div>

        <div 
          class="file-list" 
          :class="{ 'drag-over': isFileDragOver, 'empty-list': files.length === 0 }"
          v-loading="loading"
          @dragover.prevent="handleFileDragOver"
          @dragleave="handleFileDragLeave"
          @drop.prevent="handleFileListDrop"
        >
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
                <div class="file-meta">
                  <span v-if="file.type === 'directory'" class="file-type-label">文件夹</span>
                </div>
              </div>
              <div v-if="file.type === 'file'" class="file-size-col">{{ formatSize(file.size) }}</div>
              <div v-else class="file-size-col">-</div>
              <div class="file-date-col">{{ formatDate(file.date) }}</div>
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
                <div v-if="file.type === 'file'" class="grid-size">{{ formatSize(file.size) }}</div>
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
                      <el-dropdown-item divided v-if="file.type === 'file' && isCompressedFile(file.name)" @click="extractFile(file)">
                        <el-icon><FolderOpened /></el-icon>解压到当前目录
                      </el-dropdown-item>
                      <el-dropdown-item @click="compressSingleFile(file)">
                        <el-icon><Files /></el-icon>压缩
                      </el-dropdown-item>
                      <el-dropdown-item @click="copySingleFile(file)">
                        <el-icon><DocumentCopy /></el-icon>复制
                      </el-dropdown-item>
                      <el-dropdown-item @click="cutSingleFile(file)">
                        <el-icon><Scissor /></el-icon>剪切
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
        <!-- 上传区域 - 上传时自动折叠 -->
        <div v-if="!uploading" class="upload-area" :class="{ dragover: isDragover }" @dragover.prevent="isDragover = true" @dragleave="isDragover = false" @drop.prevent="handleDrop">
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
        
        <!-- 上传统计信息 -->
        <div v-if="uploading && uploadStats.startTime" class="upload-stats">
          <div class="stats-row-upload">
            <div class="stat-item-upload">
              <span class="stat-label-upload">⏱️ 已用时间</span>
              <span class="stat-value-upload">{{ formatDuration(uploadStats.duration) }}</span>
            </div>
            <div class="stat-item-upload">
              <span class="stat-label-upload">📊 已上传</span>
              <span class="stat-value-upload">{{ formatSize(uploadStats.uploadedBytes) }}</span>
            </div>
            <div class="stat-item-upload">
              <span class="stat-label-upload">🚀 上传速度</span>
              <span class="stat-value-upload">{{ formatSize(uploadStats.speed) }}/s</span>
            </div>
          </div>
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
                <div v-if="item.status === 'error' && item.errorMessage" style="font-size:11px;color:#f56c6c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.errorMessage }}</div>
              </div>
              <span style="color:#909399;font-size:12px;margin:0 10px;white-space:nowrap">{{ formatSize(item.file.size) }}</span>
              <div v-if="item.status === 'uploading'" style="flex:1;max-width:150px;margin:0 10px">
                <el-progress :percentage="item.progress || 0" :stroke-width="6" :show-text="false" />
              </div>
              <el-tag :type="item.status === 'done' ? 'success' : item.status === 'error' ? 'danger' : item.status === 'uploading' ? 'warning' : 'info'" size="small">
                {{ item.status === 'done' ? '完成' : item.status === 'error' ? '失败' : item.status === 'uploading' ? (shouldUseChunkedUpload(item.file.size) ? (item.progress >= 90 ? '合并中...' : item.progress + '%') : (item.progress >= 50 ? '处理中...' : item.progress + '%')) : '等待' }}
              </el-tag>
              <el-button v-if="item.status === 'pending'" type="danger" size="small" text @click="uploadQueue.splice(index, 1)" style="margin-left:5px"><el-icon><Close /></el-icon></el-button>
              <el-button v-if="item.status === 'uploading' && item.uploader" type="danger" size="small" text @click="cancelUpload(item)" style="margin-left:5px" title="取消上传"><el-icon><Close /></el-icon></el-button>
              <el-button v-if="item.status === 'error'" type="primary" size="small" text @click="retryUpload(item)" style="margin-left:5px" title="重试"><el-icon><Refresh /></el-icon></el-button>
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
      <el-dialog v-model="showNewFileDialog" title="新建文件" width="600px" :fullscreen="isMobile">
        <el-form label-width="90px">
          <el-form-item label="文件类型">
            <el-select v-model="newFileType" placeholder="选择文件类型" size="large" style="width:100%" @change="handleFileTypeChange">
              <el-option label="HTML 文件 (.html)" value="html" />
              <el-option label="CSS 样式 (.css)" value="css" />
              <el-option label="JavaScript (.js)" value="js" />
              <el-option label="JSON 数据 (.json)" value="json" />
              <el-option label="文本文件 (.txt)" value="txt" />
              <el-option label="Markdown (.md)" value="md" />
              <el-option label="PHP 文件 (.php)" value="php" />
              <el-option label="Python (.py)" value="py" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="文件名">
            <el-input v-model="newFileName" placeholder="例如: index" size="large">
              <template #prefix><el-icon><Document /></el-icon></template>
              <template #suffix v-if="newFileType !== 'other'">
                <span style="color:#909399">.{{ newFileType }}</span>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="使用模板">
            <el-switch v-model="useTemplate" :disabled="!hasTemplate" />
            <span style="margin-left:10px;color:#909399;font-size:12px" v-if="hasTemplate">使用 {{ newFileType.toUpperCase() }} 基础模板</span>
            <span style="margin-left:10px;color:#c0c4cc;font-size:12px" v-else>该类型暂无模板</span>
          </el-form-item>
          <el-form-item label="文件内容">
            <el-input v-model="newFileContent" type="textarea" :rows="10" placeholder="可选，留空创建空文件" />
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Link, HomeFilled, Upload, FolderAdd, Refresh, Delete, Close, Edit, View, ArrowDown, Document, Folder, QuestionFilled, Service, DocumentCopy, InfoFilled, Star, Promotion, EditPen, List, Grid, MoreFilled, FolderOpened, Scissor, Files, WarningFilled, Clock } from '@element-plus/icons-vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { ChunkedUploader, shouldUseChunkedUpload } from '@/utils/chunked-upload'

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

// 剪贴板相关
const clipboard = ref({
  files: [],
  operation: '' // 'copy' 或 'cut'
})

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

const selectAll = () => {
  selectedFiles.value = [...files.value]
  ElMessage.success(`已选中 ${files.value.length} 个项目`)
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

// 复制文件
const copyFiles = () => {
  if (selectedFiles.value.length === 0) return
  clipboard.value = {
    files: selectedFiles.value.map(f => ({
      name: f.name,
      type: f.type,
      path: currentPath.value ? `${currentPath.value}/${f.name}` : f.name
    })),
    operation: 'copy'
  }
  ElMessage.success(`已复制 ${selectedFiles.value.length} 个项目到剪贴板`)
  clearSelection()
}

// 剪切文件
const cutFiles = () => {
  if (selectedFiles.value.length === 0) return
  clipboard.value = {
    files: selectedFiles.value.map(f => ({
      name: f.name,
      type: f.type,
      path: currentPath.value ? `${currentPath.value}/${f.name}` : f.name
    })),
    operation: 'cut'
  }
  ElMessage.success(`已剪切 ${selectedFiles.value.length} 个项目到剪贴板`)
  clearSelection()
}

// 粘贴文件
const pasteFiles = async () => {
  if (clipboard.value.files.length === 0) return
  
  const loading = ElMessage({
    message: `正在${clipboard.value.operation === 'copy' ? '复制' : '移动'}文件...`,
    type: 'info',
    duration: 0
  })
  
  try {
    let success = 0, failed = 0
    
    for (const file of clipboard.value.files) {
      try {
        const targetPath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
        
        if (clipboard.value.operation === 'copy') {
          await api('/copy', { source_path: file.path, target_path: targetPath })
        } else {
          await api('/cut', { source_path: file.path, target_path: targetPath })
        }
        success++
      } catch (e) {
        console.error('粘贴失败:', e)
        failed++
      }
    }
    
    loading.close()
    
    if (failed === 0) {
      ElMessage.success(`成功${clipboard.value.operation === 'copy' ? '复制' : '移动'} ${success} 个项目`)
      if (clipboard.value.operation === 'cut') {
        clearClipboard()
      }
    } else {
      ElMessage.warning(`操作完成: 成功 ${success} 个, 失败 ${failed} 个`)
    }
    
    loadFiles()
  } catch (e) {
    loading.close()
    ElMessage.error(e.message)
  }
}

// 清空剪贴板
const clearClipboard = () => {
  clipboard.value = { files: [], operation: '' }
}

// 压缩文件
const compressFiles = async () => {
  if (selectedFiles.value.length === 0) return
  
  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      `将 ${selectedFiles.value.length} 个项目压缩为：`,
      '压缩文件',
      {
        confirmButtonText: '压缩',
        cancelButtonText: '取消',
        inputPattern: /^.+\.(zip|tar\.gz)$/,
        inputErrorMessage: '请输入有效的文件名（.zip 或 .tar.gz）',
        inputValue: 'archive.zip'
      }
    )
    
    const loading = ElMessage({
      message: '正在压缩文件...',
      type: 'info',
      duration: 0
    })
    
    try {
      const paths = selectedFiles.value.map(f => 
        currentPath.value ? `${currentPath.value}/${f.name}` : f.name
      )
      
      const format = archiveName.endsWith('.tar.gz') ? 'tar.gz' : 'zip'
      const fullArchiveName = currentPath.value ? `${currentPath.value}/${archiveName}` : archiveName
      
      await api('/compress', { 
        paths, 
        archive_name: fullArchiveName,
        format 
      })
      
      loading.close()
      ElMessage.success('压缩成功！')
      clearSelection()
      loadFiles()
    } catch (e) {
      loading.close()
      ElMessage.error('压缩失败: ' + e.message)
    }
  } catch (e) {
    // 用户取消
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

// 文件模板
const fileTemplates = {
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的网页</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f7;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
            color: #1d1d1f;
            margin-top: 0;
        }
        p {
            color: #86868b;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>欢迎来到我的网站</h1>
        <p>这是一个简单的 HTML 页面模板。</p>
        <p>您可以在这里添加您的内容。</p>
    </div>
</body>
</html>`,
  css: `/* 基础样式重置 */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6;
    color: #333;
}

/* 容器样式 */
.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}`,
  js: `// JavaScript 文件
'use strict';

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    console.log('页面加载完成');
    
    // 在这里添加您的代码
});`,
  json: `{
  "name": "my-project",
  "version": "1.0.0",
  "description": "项目描述"
}`,
  md: `# 标题

## 副标题

这是一个 Markdown 文档。

### 功能列表

- 项目 1
- 项目 2
- 项目 3

### 代码示例

\`\`\`javascript
console.log('Hello World');
\`\`\``,
  php: `<?php
// PHP 文件
header('Content-Type: text/html; charset=utf-8');

echo "Hello World";
?>`,
  py: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def main():
    print("Hello World")

if __name__ == "__main__":
    main()`
}

// 处理文件类型变化
const handleFileTypeChange = () => {
  // 如果有模板且开启了使用模板，则填充模板内容
  if (useTemplate.value && fileTemplates[newFileType.value]) {
    newFileContent.value = fileTemplates[newFileType.value]
  } else {
    newFileContent.value = ''
  }
}

// 可解压的文件类型
const compressedExts = ['zip', 'gz', 'tgz', 'tar', '7z']
const isCompressedFile = (name) => {
  const ext = name.split('.').pop().toLowerCase()
  return compressedExts.includes(ext) || name.toLowerCase().endsWith('.tar.gz')
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
const newFileType = ref('html')
const useTemplate = ref(true)
const newFileContent = ref('')
const creatingFile = ref(false)

// 检查是否有模板
const hasTemplate = computed(() => {
  return fileTemplates.hasOwnProperty(newFileType.value)
})

// 监听模板开关变化
watch(useTemplate, (val) => {
  if (val && fileTemplates[newFileType.value]) {
    newFileContent.value = fileTemplates[newFileType.value]
  } else if (!val) {
    newFileContent.value = ''
  }
})
const showTutorialDialog = ref(false)
const showQuickTutorial = ref(false)
const showContactDialog = ref(false)
const showRenameDialog = ref(false)
const renamingFile = ref(null)
const renaming = ref(false)
const uploadQueue = ref([])
const uploading = ref(false)
const isDragover = ref(false)
const isFileDragOver = ref(false)
const newFolderName = ref('')
const creating = ref(false)

// 上传统计
const uploadStats = ref({
  startTime: null,
  totalBytes: 0,
  uploadedBytes: 0,
  duration: 0,
  speed: 0
})
const uploadStatsInterval = ref(null)

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
  const res = await api('/auth')
  console.log('verifyAuth response:', res)
  domain.value = res.domain
  homeDir.value = res.home_dir
  maxUploadSize.value = res.max_upload_size || 209715200
  expireAt.value = res.expire_at || null
  remainingDays.value = res.remaining_days
  
  authorized.value = true
  localStorage.setItem('upload_auth_code', authCode.value)
  await loadFiles()
  verifying.value = false
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
  const res = await api('/list', { path: currentPath.value })
  files.value = res.files.sort((a, b) => { 
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name) 
  })
  const usage = await api('/usage')
  usedSize.value = usage.used_size || 0
  loading.value = false
}

const navigateTo = (path) => { currentPath.value = path; selectedFiles.value = []; loadFiles() }
const goBack = () => { const parts = currentPath.value.split('/').filter(p => p); parts.pop(); currentPath.value = parts.join('/'); selectedFiles.value = []; loadFiles() }

const handleFileSelect = (e) => { checkAndAddFiles(e.target.files, false); e.target.value = '' }
const handleFolderSelect = (e) => { checkAndAddFiles(e.target.files, true); e.target.value = '' }
const handleUploadCommand = (cmd) => {
  if (cmd === 'file') fileInputRef.value?.click()
  else if (cmd === 'folder') folderInputRef.value?.click()
}

// 检查文件是否存在并添加到队列
const checkAndAddFiles = async (fileList, keepPath = false) => {
  const filesToAdd = Array.from(fileList).map(f => {
    const relativePath = keepPath && f.webkitRelativePath ? f.webkitRelativePath : f.name
    return { 
      file: f, 
      name: f.name, 
      relativePath: relativePath !== f.name ? relativePath : '', 
      uploadPath: relativePath, 
      status: 'pending', 
      progress: 0 
    }
  })
  
  // 检查哪些文件已存在
  const existingFiles = []
  for (const item of filesToAdd) {
    const filePath = item.relativePath || item.name
    const pathParts = filePath.split('/')
    const fileName = pathParts[pathParts.length - 1]
    
    // 构建完整路径
    let checkPath = currentPath.value
    if (pathParts.length > 1) {
      const dirs = pathParts.slice(0, -1).join('/')
      checkPath = currentPath.value ? `${currentPath.value}/${dirs}` : dirs
    }
    
    // 检查文件是否存在
    const exists = files.value.some(f => {
      if (f.type !== 'file') return false
      // 如果在当前目录，直接比较文件名
      if (!item.relativePath || pathParts.length === 1) {
        return f.name === fileName && currentPath.value === checkPath
      }
      return false
    })
    
    if (exists) {
      existingFiles.push(item)
    }
  }
  
  // 如果有文件已存在，显示确认对话框
  if (existingFiles.length > 0) {
    await handleFileConflict(filesToAdd, existingFiles)
  } else {
    uploadQueue.value.push(...filesToAdd)
  }
}

// 处理文件冲突
const handleFileConflict = async (allFiles, existingFiles) => {
  if (existingFiles.length === 1) {
    // 单个文件冲突
    try {
      await ElMessageBox.confirm(
        `文件 "${existingFiles[0].name}" 已存在，是否覆盖？`,
        '文件已存在',
        {
          type: 'warning',
          confirmButtonText: '覆盖',
          cancelButtonText: '跳过'
        }
      )
      // 用户选择覆盖，添加所有文件
      uploadQueue.value.push(...allFiles)
    } catch (e) {
      // 用户选择跳过，只添加不存在的文件
      const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
      uploadQueue.value.push(...filesToAdd)
      if (filesToAdd.length > 0) {
        ElMessage.info(`已跳过 1 个文件，添加了 ${filesToAdd.length} 个文件`)
      } else {
        ElMessage.info('已跳过该文件')
      }
    }
  } else {
    // 多个文件冲突
    try {
      const action = await ElMessageBox.confirm(
        `有 ${existingFiles.length} 个文件已存在，如何处理？`,
        '批量文件冲突',
        {
          type: 'warning',
          distinguishCancelAndClose: true,
          confirmButtonText: '全部覆盖',
          cancelButtonText: '全部跳过',
          closeOnClickModal: false
        }
      )
      // 用户选择全部覆盖
      uploadQueue.value.push(...allFiles)
      ElMessage.success(`已添加 ${allFiles.length} 个文件（将覆盖已存在的文件）`)
    } catch (action) {
      if (action === 'cancel') {
        // 用户选择全部跳过
        const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
        uploadQueue.value.push(...filesToAdd)
        if (filesToAdd.length > 0) {
          ElMessage.info(`已跳过 ${existingFiles.length} 个文件，添加了 ${filesToAdd.length} 个文件`)
        } else {
          ElMessage.info(`已跳过所有文件`)
        }
      } else {
        // 用户关闭对话框，不添加任何文件
        ElMessage.info('已取消添加文件')
      }
    }
  }
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
  
  // 检查文件冲突
  const existingFiles = []
  for (const item of filesList) {
    const filePath = item.relativePath || item.name
    const pathParts = filePath.split('/')
    const fileName = pathParts[pathParts.length - 1]
    
    // 检查文件是否存在（只检查当前目录的文件）
    if (!item.relativePath || pathParts.length === 1) {
      const exists = files.value.some(f => f.type === 'file' && f.name === fileName)
      if (exists) {
        existingFiles.push(item)
      }
    }
  }
  
  // 如果有文件已存在，显示确认对话框
  if (existingFiles.length > 0) {
    await handleFileConflict(filesList, existingFiles)
  } else {
    uploadQueue.value.push(...filesList)
  }
}

// 文件列表区域拖拽处理
const handleFileDragOver = (e) => {
  e.preventDefault()
  isFileDragOver.value = true
}

const handleFileDragLeave = (e) => {
  // 只有当离开整个文件列表区域时才取消高亮
  if (e.target.classList.contains('file-list')) {
    isFileDragOver.value = false
  }
}

const handleFileListDrop = async (e) => {
  e.preventDefault()
  isFileDragOver.value = false
  
  // 自动打开上传对话框
  showUploadDialog.value = true
  
  // 处理拖拽的文件
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
            else { 
              for (const ent of entries) { 
                await readEntry(ent, path ? path + '/' + entry.name : entry.name) 
              }
              readEntries() 
            }
          })
        }
        readEntries()
      })
    }
  }
  
  const promises = []
  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
    if (entry) { 
      promises.push(readEntry(entry)) 
    } else if (item.kind === 'file') { 
      const file = item.getAsFile()
      if (file) {
        filesList.push({ file, name: file.name, relativePath: '', uploadPath: file.name, status: 'pending' })
      }
    }
  }
  
  await Promise.all(promises)
  
  if (filesList.length > 0) {
    // 检查文件冲突
    const existingFiles = []
    for (const item of filesList) {
      const filePath = item.relativePath || item.name
      const pathParts = filePath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      
      // 检查文件是否存在（只检查当前目录的文件）
      if (!item.relativePath || pathParts.length === 1) {
        const exists = files.value.some(f => f.type === 'file' && f.name === fileName)
        if (exists) {
          existingFiles.push(item)
        }
      }
    }
    
    // 如果有文件已存在，显示确认对话框
    if (existingFiles.length > 0) {
      await handleFileConflict(filesList, existingFiles)
    } else {
      uploadQueue.value.push(...filesList)
    }
    
    ElMessage.success(`已添加 ${filesList.length} 个文件到上传队列`)
  }
}

const startUpload = async () => {
  const totalUploadSize = uploadQueue.value.filter(f => f.status === 'pending').reduce((sum, f) => sum + f.file.size, 0)
  const remaining = maxUploadSize.value - usedSize.value
  if (totalUploadSize > remaining) { ElMessage.error(`空间不足！待上传 ${formatSize(totalUploadSize)}，剩余 ${formatSize(remaining)}`); return }
  
  uploading.value = true
  
  // 初始化上传统计
  uploadStats.value = {
    startTime: Date.now(),
    totalBytes: totalUploadSize,
    uploadedBytes: 0,
    duration: 0,
    speed: 0
  }
  
  // 启动统计更新定时器
  uploadStatsInterval.value = setInterval(() => {
    if (uploadStats.value.startTime) {
      uploadStats.value.duration = Date.now() - uploadStats.value.startTime
      // 计算已上传字节数
      const uploaded = uploadQueue.value
        .filter(f => f.status === 'done')
        .reduce((sum, f) => sum + f.file.size, 0)
      
      // 加上正在上传的文件的进度
      const uploading = uploadQueue.value
        .filter(f => f.status === 'uploading')
        .reduce((sum, f) => sum + (f.file.size * (f.progress || 0) / 100), 0)
      
      uploadStats.value.uploadedBytes = uploaded + uploading
      
      // 计算速度 (字节/秒)
      if (uploadStats.value.duration > 0) {
        uploadStats.value.speed = (uploadStats.value.uploadedBytes / uploadStats.value.duration) * 1000
      }
    }
  }, 500)
  
  // 使用并发上传
  await startNormalUpload()
  
  // 清理定时器
  if (uploadStatsInterval.value) {
    clearInterval(uploadStatsInterval.value)
    uploadStatsInterval.value = null
  }
  
  uploading.value = false
  loadFiles()
  const success = uploadQueue.value.filter(f => f.status === 'done').length
  const failed = uploadQueue.value.filter(f => f.status === 'error').length
  
  // 显示上传完成信息（包含统计）
  const duration = uploadStats.value.duration
  const totalSize = uploadStats.value.uploadedBytes
  const avgSpeed = duration > 0 ? (totalSize / duration) * 1000 : 0
  
  if (failed === 0) {
    ElMessage.success(`上传完成！共 ${success} 个文件，${formatSize(totalSize)}，耗时 ${formatDuration(duration)}，平均速度 ${formatSize(avgSpeed)}/s`)
  } else {
    ElMessage.warning(`上传完成: 成功${success}个, 失败${failed}个`)
  }
}

// 上传单个文件（提取出来以支持并发）
const uploadSingleFile = async (item) => {
  if (item.status !== 'pending') return
  
  item.status = 'uploading'
  item.progress = 0
  
  try {
    let uploadDir = currentPath.value
    const filePath = item.uploadPath || item.name
    const pathParts = filePath.split('/')
    const fileName = pathParts.pop()
    if (pathParts.length > 0) uploadDir = currentPath.value ? currentPath.value + '/' + pathParts.join('/') : pathParts.join('/')
    
    // 判断是否使用分片上传（大于 5MB）
    if (shouldUseChunkedUpload(item.file.size)) {
      // 使用分片上传
      const uploader = new ChunkedUploader(item.file, {
        authCode: authCode.value,
        path: uploadDir,
        onProgress: (progress) => {
          // 分片上传进度占 90%，合并占 10%
          item.progress = Math.round(progress.percentage * 0.9)
        },
        onSuccess: () => {
          item.progress = 100
        },
        onError: (err) => {
          console.error('分片上传失败:', err)
          item.errorMessage = err.message || '分片上传失败'
        }
      })
      
      // 保存 uploader 实例以便取消
      item.uploader = uploader
      
      try {
        await uploader.start()
        item.status = 'done'
        item.progress = 100
        usedSize.value += item.file.size
      } catch (err) {
        throw new Error(`分片上传失败: ${err.message}`)
      }
    } else {
      // 使用普通上传（小文件）
      const formData = new FormData()
      formData.append('auth_code', authCode.value)
      formData.append('path', uploadDir)
      formData.append('filename', fileName)
      formData.append('file', item.file)
      
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            // 上传到后端服务器占 50%，后端处理占 50%
            item.progress = Math.round((e.loaded / e.total) * 50)
          }
        })
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const res = JSON.parse(xhr.responseText)
            if (res.error) reject(new Error(res.error))
            else {
              // 后端处理完成，显示 100%
              item.progress = 100
              resolve(res)
            }
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
    }
  } catch (e) { 
    item.status = 'error'
    item.errorMessage = e.message || '上传失败'
    console.error('Upload error:', e)
    ElMessage.error(`上传失败: ${item.name} - ${e.message}`)
  }
}

// 普通上传（支持并发）
const startNormalUpload = async () => {
  const concurrency = 10 // 同时上传 10 个文件
  const pending = uploadQueue.value.filter(f => f.status === 'pending')
  
  // 分批并发上传
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency)
    await Promise.all(batch.map(item => uploadSingleFile(item)))
  }
}

const fileToBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })

// 取消上传
const cancelUpload = async (item) => {
  if (item.uploader) {
    await item.uploader.abort()
    item.status = 'error'
    ElMessage.warning('已取消上传')
  }
}

// 重试上传
const retryUpload = async (item) => {
  item.status = 'pending'
  item.errorMessage = ''
  item.progress = 0
  
  // 重新开始上传
  await startUpload()
}

const createFolder = async () => {
  if (!newFolderName.value) { ElMessage.warning('请输入文件夹名称'); return }
  creating.value = true
  await api('/mkdir', { path: currentPath.value, name: newFolderName.value })
  ElMessage.success('创建成功')
  showMkdirDialog.value = false
  newFolderName.value = ''
  await loadFiles()
  creating.value = false
}

const createFile = async () => {
  if (!newFileName.value) { ElMessage.warning('请输入文件名'); return }
  
  // 构建完整文件名（添加扩展名）
  const fullFileName = newFileType.value === 'other' 
    ? newFileName.value 
    : newFileName.value.endsWith(`.${newFileType.value}`)
      ? newFileName.value
      : `${newFileName.value}.${newFileType.value}`
  
  // 检查文件是否已存在
  const existingFile = files.value.find(f => f.name === fullFileName && f.type === 'file')
  
  if (existingFile) {
    try {
      await ElMessageBox.confirm(
        `文件 "${fullFileName}" 已存在，是否覆盖？`,
        '文件已存在',
        {
          type: 'warning',
          confirmButtonText: '覆盖',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--danger'
        }
      )
    } catch (e) {
      // 用户取消
      return
    }
  }
  
  creatingFile.value = true
  
  try {
    await api('/create-file', { path: currentPath.value, name: fullFileName, content: newFileContent.value || '' })
    ElMessage.success(existingFile ? '文件已覆盖' : '创建成功')
    showNewFileDialog.value = false
    
    // 重置表单
    newFileName.value = ''
    newFileType.value = 'html'
    useTemplate.value = true
    newFileContent.value = ''
    
    await loadFiles()
  } catch (err) {
    ElMessage.error('创建失败: ' + err.message)
  } finally {
    creatingFile.value = false
  }
}

// 打开新建文件对话框
const openNewFileDialog = () => {
  // 重置表单
  newFileName.value = ''
  newFileType.value = 'html'
  useTemplate.value = true
  newFileContent.value = fileTemplates.html
  showNewFileDialog.value = true
}

const deleteFile = async (file) => {
  await ElMessageBox.confirm(`确定删除 "${file.name}"？${file.type === 'directory' ? '文件夹内所有内容将被删除！' : ''}`, '确认删除', { type: 'warning' })
  const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
  await api('/delete', { path: filePath })
  ElMessage.success('删除成功')
  await loadFiles()
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
  const oldPath = currentPath.value ? `${currentPath.value}/${renamingFile.value.name}` : renamingFile.value.name
  const newPath = currentPath.value ? `${currentPath.value}/${newFileName.value}` : newFileName.value
  await api('/rename', { oldPath, newPath })
  ElMessage.success('重命名成功')
  showRenameDialog.value = false
  await loadFiles()
  renaming.value = false
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

// 解压文件
const extractFile = async (file) => {
  if (!isCompressedFile(file.name)) {
    ElMessage.warning('该文件不是压缩包')
    return
  }
  
  try {
    await ElMessageBox.confirm(
      `确定要解压 "${file.name}" 到当前目录吗？`,
      '解压文件',
      { 
        type: 'info',
        confirmButtonText: '解压',
        cancelButtonText: '取消'
      }
    )
    
    const loadingMsg = ElMessage({
      message: '正在解压，请稍候...',
      type: 'info',
      duration: 0,
      icon: 'Loading'
    })
    
    try {
      const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
      await api('/extract', { path: filePath })
      loadingMsg.close()
      ElMessage.success('解压成功！')
      loadFiles()
    } catch (e) {
      loadingMsg.close()
      ElMessage.error('解压失败: ' + e.message)
    }
  } catch (e) {
    // 用户取消
  }
}

// 压缩单个文件
const compressSingleFile = async (file) => {
  try {
    const defaultName = file.name + '.zip'
    const { value: archiveName } = await ElMessageBox.prompt(
      `将 "${file.name}" 压缩为：`,
      '压缩文件',
      {
        confirmButtonText: '压缩',
        cancelButtonText: '取消',
        inputPattern: /^.+\.(zip|tar\.gz)$/,
        inputErrorMessage: '请输入有效的文件名（.zip 或 .tar.gz）',
        inputValue: defaultName
      }
    )
    
    const loading = ElMessage({
      message: '正在压缩文件...',
      type: 'info',
      duration: 0
    })
    
    try {
      const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
      const format = archiveName.endsWith('.tar.gz') ? 'tar.gz' : 'zip'
      const fullArchiveName = currentPath.value ? `${currentPath.value}/${archiveName}` : archiveName
      
      await api('/compress', { 
        paths: [filePath], 
        archive_name: fullArchiveName,
        format 
      })
      
      loading.close()
      ElMessage.success('压缩成功！')
      loadFiles()
    } catch (e) {
      loading.close()
      ElMessage.error('压缩失败: ' + e.message)
    }
  } catch (e) {
    // 用户取消
  }
}

// 复制单个文件
const copySingleFile = (file) => {
  clipboard.value = {
    files: [{
      name: file.name,
      type: file.type,
      path: currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    }],
    operation: 'copy'
  }
  ElMessage.success(`已复制 "${file.name}" 到剪贴板`)
}

// 剪切单个文件
const cutSingleFile = (file) => {
  clipboard.value = {
    files: [{
      name: file.name,
      type: file.type,
      path: currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    }],
    operation: 'cut'
  }
  ElMessage.success(`已剪切 "${file.name}" 到剪贴板`)
}

const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

const formatDuration = (ms) => {
  if (!ms || ms === 0) return '0秒'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return `${hours}小时${minutes % 60}分${seconds % 60}秒`
  } else if (minutes > 0) {
    return `${minutes}分${seconds % 60}秒`
  } else {
    return `${seconds}秒`
  }
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

// 格式化到期日期（更友好的显示）
const formatExpireDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}年${m}月${d}日`
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
.upload-page { 
  min-height: 100vh; 
  background: linear-gradient(135deg, #F5F5F7 0%, #FAFAFA 100%);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  position: relative;
}
.upload-page::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: 
    radial-gradient(circle at 20% 30%, rgba(0, 122, 255, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(88, 86, 214, 0.06) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(255, 149, 0, 0.03) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
  animation: backgroundPulse 20s ease-in-out infinite;
}
@keyframes backgroundPulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}
.auth-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; position: relative; }
.auth-box { 
  width: 420px; 
  padding: 50px 40px; 
  background: rgba(255, 255, 255, 0.5); 
  backdrop-filter: blur(80px) saturate(180%);
  -webkit-backdrop-filter: blur(80px) saturate(180%);
  border-radius: 28px; 
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 24px 64px rgba(0, 0, 0, 0.06),
    0 4px 12px rgba(0, 0, 0, 0.03); 
  text-align: center;
  border: 0.5px solid rgba(255, 255, 255, 1);
}
.auth-contact { 
  position: fixed; 
  bottom: 30px; 
  right: 30px; 
  background: linear-gradient(135deg, #007AFF 0%, #0095FF 100%); 
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  color: #fff; 
  padding: 12px 24px; 
  border-radius: 24px; 
  cursor: pointer; 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.2) inset,
    0 8px 24px rgba(0, 122, 255, 0.3),
    0 2px 8px rgba(0, 122, 255, 0.2); 
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
  font-weight: 500;
  font-size: 14px;
}
.auth-contact:hover { 
  transform: translateY(-2px) scale(1.02); 
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.3) inset,
    0 12px 32px rgba(0, 122, 255, 0.4),
    0 4px 12px rgba(0, 122, 255, 0.25); 
}
.auth-logo { font-size: 48px; margin-bottom: 10px; }
.auth-title { margin-bottom: 10px; color: #1c1c1e; font-size: 28px; font-weight: 600; letter-spacing: -0.5px; }
.auth-subtitle { color: #8e8e93; margin-bottom: 30px; font-size: 14px; font-weight: 400; }
.main-container { max-width: 1200px; margin: 0 auto; padding: 20px; position: relative; z-index: 1; }
.header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 20px; 
  padding: 12px 20px; 
  background: rgba(255, 255, 255, 0.5); 
  backdrop-filter: blur(80px) saturate(180%);
  -webkit-backdrop-filter: blur(80px) saturate(180%);
  border-radius: 20px; 
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 8px 24px rgba(0, 0, 0, 0.04),
    0 1px 3px rgba(0, 0, 0, 0.02);
  border: 0.5px solid rgba(255, 255, 255, 1);
}
.header-left { display: flex; align-items: center; gap: 15px; }
.domain-info { font-size: 19px; font-weight: 600; color: #1c1c1e; letter-spacing: -0.3px; }
.header-actions { display: flex; gap: 10px; }
.stats-row { 
  display: grid; 
  grid-template-columns: repeat(5, 1fr); 
  gap: 15px; 
  margin-bottom: 20px; 
}
.stat-card { 
  padding: 18px 16px; 
  border-radius: 16px; 
  box-shadow: 
    0 0 0 0.5px rgba(0, 0, 0, 0.04) inset,
    0 2px 8px rgba(0, 0, 0, 0.03),
    0 1px 2px rgba(0, 0, 0, 0.02); 
  text-align: center;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
  border: 0.5px solid rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.4) 100%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.stat-card:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 
    0 0 0 0.5px rgba(0, 122, 255, 0.1) inset,
    0 12px 32px rgba(0, 0, 0, 0.08),
    0 4px 12px rgba(0, 122, 255, 0.06);
}
.stat-card:hover::before {
  opacity: 0.6;
}
.stat-card:active {
  transform: translateY(-2px) scale(1.01);
  transition: all 0.1s;
}
.stat-card:nth-child(1) { 
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(0, 122, 255, 0.06) 100%);
  border-color: rgba(0, 122, 255, 0.15);
}
.stat-card:nth-child(2) { 
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
}
.stat-card:nth-child(3) { 
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
}
.stat-card:nth-child(4) { 
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
}
.stat-card:nth-child(5) { 
  background: linear-gradient(135deg, rgba(255, 249, 240, 0.95) 0%, rgba(255, 249, 240, 0.85) 100%);
  border-color: rgba(255, 149, 0, 0.1);
}
.stat-value { 
  font-size: 28px; 
  font-weight: 700; 
  color: #1c1c1e;
  position: relative;
  z-index: 1;
  letter-spacing: -1.2px;
  line-height: 1.2;
  background: linear-gradient(135deg, #1c1c1e 0%, #3c3c43 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.stat-card:nth-child(1) .stat-value {
  background: linear-gradient(135deg, #007AFF 0%, #0051D5 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.stat-label { 
  color: #6e6e73; 
  font-size: 12px; 
  margin-top: 8px;
  font-weight: 600;
  position: relative;
  z-index: 1;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  opacity: 0.85;
}

/* 续费提醒样式 */
.renew-alert-container { 
  margin-bottom: 20px; 
}
.renew-alert-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.8) inset,
    0 4px 24px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
}
.renew-alert-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #FF9500 0%, #FF6B00 100%);
  opacity: 0;
  transition: opacity 0.3s;
}
.renew-alert-card.expired::before {
  background: linear-gradient(90deg, #FF3B30 0%, #D70015 100%);
  opacity: 1;
}
.renew-alert-card.warning::before {
  opacity: 1;
}
.renew-alert-card.expired {
  background: linear-gradient(135deg, rgba(255, 59, 48, 0.1) 0%, rgba(255, 59, 48, 0.05) 100%);
  border-color: rgba(255, 59, 48, 0.25);
}
.renew-alert-card.warning {
  background: linear-gradient(135deg, rgba(255, 149, 0, 0.1) 0%, rgba(255, 149, 0, 0.05) 100%);
  border-color: rgba(255, 149, 0, 0.25);
}
.renew-alert-card:hover {
  transform: translateY(-3px) scale(1.01);
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 8px 40px rgba(0, 0, 0, 0.12),
    0 4px 16px rgba(0, 0, 0, 0.06);
}
.renew-alert-icon {
  flex-shrink: 0;
}
.renew-alert-content {
  flex: 1;
  min-width: 0;
}
.renew-alert-title {
  font-size: 18px;
  font-weight: 600;
  color: #1D1D1F;
  margin-bottom: 6px;
  letter-spacing: -0.3px;
}
.renew-alert-message {
  font-size: 14px;
  color: #3c3c43;
  line-height: 1.5;
  margin-bottom: 4px;
}
.renew-alert-info {
  margin-top: 4px;
}
.renew-alert-action {
  flex-shrink: 0;
}

.card { 
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.5) 100%); 
  backdrop-filter: blur(80px) saturate(180%);
  -webkit-backdrop-filter: blur(80px) saturate(180%);
  padding: 24px; 
  border-radius: 20px; 
  margin-bottom: 20px; 
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 8px 32px rgba(0, 0, 0, 0.05),
    0 2px 8px rgba(0, 0, 0, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 1);
  transition: all 0.3s;
}
.card:hover {
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 12px 40px rgba(0, 0, 0, 0.06),
    0 4px 12px rgba(0, 0, 0, 0.04);
}
.toolbar { 
  display: flex; 
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px; 
  padding: 12px 16px; 
  background: linear-gradient(135deg, rgba(248, 248, 250, 0.8) 0%, rgba(242, 242, 247, 0.6) 100%);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border-radius: 16px;
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.8) inset,
    0 2px 12px rgba(0, 0, 0, 0.03),
    0 1px 3px rgba(0, 0, 0, 0.02);
  border: 0.5px solid rgba(209, 209, 214, 0.25);
  transition: all 0.3s;
}
.toolbar:hover {
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.9) inset,
    0 4px 16px rgba(0, 0, 0, 0.04),
    0 2px 6px rgba(0, 0, 0, 0.02);
}
.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
}
.toolbar-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.batch-operations {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.08) 0%, rgba(0, 122, 255, 0.04) 100%);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border-radius: 14px;
  border: 0.5px solid rgba(0, 122, 255, 0.2);
  box-shadow: 
    0 0 0 0.5px rgba(0, 122, 255, 0.05) inset,
    0 2px 8px rgba(0, 122, 255, 0.06);
  animation: slideDown 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.breadcrumb { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  flex-wrap: wrap;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.7) 100%);
  backdrop-filter: blur(60px);
  -webkit-backdrop-filter: blur(60px);
  padding: 8px 14px;
  border-radius: 14px;
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.9) inset,
    0 2px 8px rgba(0, 0, 0, 0.03),
    0 1px 2px rgba(0, 0, 0, 0.02);
  border: 0.5px solid rgba(209, 209, 214, 0.3);
  transition: all 0.3s;
}
.breadcrumb:hover {
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 1) inset,
    0 4px 12px rgba(0, 0, 0, 0.04),
    0 2px 4px rgba(0, 0, 0, 0.02);
}
.breadcrumb-item { 
  cursor: pointer; 
  color: #007aff; 
  padding: 4px 10px; 
  border-radius: 8px; 
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  font-weight: 600;
  font-size: 13px;
  position: relative;
}
.breadcrumb-item::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(0, 122, 255, 0.06) 100%);
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}
.breadcrumb-item:hover { 
  transform: translateY(-1px) scale(1.05);
}
.breadcrumb-item:hover::before {
  opacity: 1;
}
.breadcrumb-item span {
  position: relative;
  z-index: 1;
}
.breadcrumb-sep { 
  color: #c7c7cc; 
}
.file-list { 
  height: 350px; 
  overflow-y: auto; 
  overflow-x: hidden; 
  position: relative;
  transition: all 0.3s;
}
.file-list.drag-over {
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border: 2px dashed #409eff;
  border-radius: 8px;
}
/* 只在空目录时显示大提示 */
.file-list.drag-over.empty-list::before {
  content: '📤 拖放文件到这里上传';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  color: #409eff;
  font-weight: bold;
  pointer-events: none;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  padding: 20px 40px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}
/* 有文件时显示小提示 */
.file-list.drag-over:not(.empty-list)::after {
  content: '📤 松开鼠标上传文件';
  position: fixed;
  bottom: 20px;
  right: 20px;
  font-size: 14px;
  color: #fff;
  background: #409eff;
  padding: 12px 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.5);
  z-index: 1000;
  animation: bounce 0.5s ease-in-out infinite alternate;
}
@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(-5px); }
}
.file-item { 
  display: flex; 
  align-items: center; 
  padding: 8px 12px; 
  border-radius: 10px; 
  margin-bottom: 3px; 
  cursor: pointer; 
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); 
  background: #FFFFFF;
  border: 0.5px solid rgba(209, 209, 214, 0.15);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.01);
  position: relative;
}
.file-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(135deg, #007AFF 0%, #0095FF 100%);
  border-radius: 10px 0 0 10px;
  opacity: 0;
  transition: opacity 0.2s;
}
.file-item:hover { 
  background: linear-gradient(135deg, #F9F9FB 0%, #F2F2F7 100%); 
  border-color: rgba(0, 122, 255, 0.2);
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.file-item:hover::before {
  opacity: 1;
}
.file-item.selected { 
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(0, 122, 255, 0.06) 100%); 
  border: 0.5px solid rgba(0, 122, 255, 0.3); 
  box-shadow: 0 2px 12px rgba(0, 122, 255, 0.12);
}
.file-item.selected::before {
  opacity: 1;
}
.file-checkbox { width: 28px; display: flex; align-items: center; justify-content: center; }
.file-icon { 
  width: 28px; 
  font-size: 16px; 
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.file-item:hover .file-icon {
  transform: scale(1.15);
}
.file-info { flex: 1; min-width: 0; }
.file-name { 
  font-weight: 600; 
  color: #1c1c1e; 
  font-size: 12px; 
  overflow: hidden; 
  text-overflow: ellipsis; 
  white-space: nowrap; 
  letter-spacing: -0.2px;
  transition: color 0.2s;
}
.file-item:hover .file-name {
  color: #007AFF;
}
.file-meta { font-size: 10px; color: #8e8e93; margin-top: 2px; }
.file-type-label { 
  color: #34c759; 
  font-weight: 600;
  padding: 2px 6px;
  background: rgba(52, 199, 89, 0.1);
  border-radius: 4px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.file-size-col { 
  width: 90px; 
  text-align: right; 
  color: #007aff; 
  font-weight: 600; 
  font-size: 11px; 
  flex-shrink: 0; 
  padding-right: 12px;
  font-variant-numeric: tabular-nums;
}
.file-date-col { 
  width: 140px; 
  text-align: right; 
  color: #8e8e93; 
  font-size: 10px; 
  flex-shrink: 0; 
  padding-right: 12px;
  font-variant-numeric: tabular-nums;
}
.file-actions { transition: opacity 0.2s; flex-shrink: 0; }

/* 网格视图 */
.file-grid { display: grid; grid-template-columns: repeat(auto-fill, 100px); gap: 15px; padding: 10px 0; justify-content: center; }
.grid-item { 
  position: relative; 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  padding: 15px 10px; 
  border-radius: 16px; 
  cursor: pointer; 
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); 
  background: #FFFFFF; 
  width: 100px; 
  height: 100px; 
  justify-content: center;
  border: 0.5px solid rgba(209, 209, 214, 0.2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.01);
}
.grid-item:hover { 
  background: #F2F2F7; 
  border-color: rgba(209, 209, 214, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}
.grid-item.selected { 
  background: rgba(0, 122, 255, 0.08); 
  border: 1px solid rgba(0, 122, 255, 0.3); 
  box-shadow: 0 4px 16px rgba(0, 122, 255, 0.08);
}
.grid-checkbox { position: absolute; top: 5px; left: 5px; opacity: 0; transition: opacity 0.2s; }
.grid-item:hover .grid-checkbox, .grid-item.selected .grid-checkbox { opacity: 1; }
.grid-icon { font-size: 36px; margin-bottom: 6px; }
.grid-name { font-size: 12px; color: #1c1c1e; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 5px; font-weight: 500; letter-spacing: -0.1px; }
.grid-size { font-size: 10px; color: #007aff; text-align: center; margin-top: 2px; font-weight: 500; }
.grid-more { position: absolute; top: 5px; right: 5px; opacity: 0; transition: opacity 0.2s; }
.grid-item:hover .grid-more { opacity: 1; }
.upload-area { 
  border: 2px dashed rgba(209, 209, 214, 0.6); 
  border-radius: 20px; 
  padding: 40px 30px; 
  text-align: center; 
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(60px);
  -webkit-backdrop-filter: blur(60px);
}
.upload-area:hover { 
  border-color: rgba(0, 122, 255, 0.4); 
  background: rgba(0, 122, 255, 0.04); 
}
.upload-area.dragover { 
  border-color: rgba(0, 122, 255, 0.6); 
  background: rgba(0, 122, 255, 0.06); 
  transform: scale(1.01); 
  box-shadow: 0 8 24px rgba(0, 122, 255, 0.12);
}
.upload-icon { font-size: 48px; margin-bottom: 8px; }
.upload-text { color: #1D1D1F; font-size: 15px; margin-bottom: 8px; font-weight: 500; letter-spacing: -0.2px; }
.upload-or { color: #86868B; font-size: 13px; margin-bottom: 15px; }
.upload-hint { color: #86868B; font-size: 13px; margin-top: 15px; }

/* 上传统计样式 */
.upload-stats { 
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.65) 0%, rgba(0, 149, 255, 0.65) 100%); 
  backdrop-filter: blur(80px);
  -webkit-backdrop-filter: blur(80px);
  border-radius: 20px; 
  padding: 20px; 
  margin-bottom: 20px;
  box-shadow: 
    0 0 0 0.5px rgba(255, 255, 255, 0.3) inset,
    0 8px 24px rgba(0, 122, 255, 0.25);
  border: 0.5px solid rgba(255, 255, 255, 0.4);
}
.stats-row-upload { display: flex; gap: 15px; justify-content: space-around; }
.stat-item-upload { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.stat-label-upload { color: rgba(255,255,255,0.9); font-size: 13px; }
.stat-value-upload { color: #fff; font-size: 20px; font-weight: bold; }

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
  
  /* 续费提醒移动端 */
  .renew-alert-card {
    flex-direction: column;
    text-align: center;
    gap: 15px;
    padding: 20px 15px;
  }
  .renew-alert-title {
    font-size: 16px;
  }
  .renew-alert-message {
    font-size: 13px;
  }
  .renew-alert-action {
    width: 100%;
  }
  .renew-alert-action .el-button {
    width: 100%;
  }
  
  /* 统计卡片移动端 - 2行3列布局 */
  .stats-row { 
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .stat-card { 
    padding: 15px 10px;
  }
  .stat-card:nth-child(4),
  .stat-card:nth-child(5) {
    grid-column: span 1;
  }
  /* 如果只想让第5个卡片居中，可以用这个 */
  .stat-card:nth-child(5) {
    grid-column: 2 / 3;
  }
  .stat-value { font-size: 20px; color: #1D1D1F; }
  .stat-label { font-size: 11px; color: #86868B; }
  
  .card { padding: 15px; }
  .toolbar { 
    flex-direction: column; 
    gap: 12px; 
    align-items: stretch;
    padding: 12px 15px;
  }
  .toolbar > div { width: 100%; }
  .toolbar > div:last-child { 
    display: flex; 
    flex-wrap: wrap; 
    gap: 8px; 
  }
  .toolbar > div:last-child .el-button { 
    flex: 1; 
    min-width: 90px;
    font-size: 12px;
  }
  .toolbar > div:last-child .el-button .el-icon {
    font-size: 14px;
  }
  
  .file-item { padding: 10px 12px; }
  .file-icon { width: 36px; font-size: 22px; }
  .file-name { font-size: 13px; }
  .file-meta { font-size: 10px; }
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
  
  /* 上传统计响应式 */
  .stats-row-upload { flex-direction: column; gap: 10px; }
  .stat-item-upload { flex-direction: row; justify-content: space-between; width: 100%; }
  .stat-value-upload { font-size: 18px; }
  
  .empty-tip { padding: 30px 0; }
  .empty-icon { font-size: 40px; }
  .quick-actions { flex-direction: column; }
}

@media (max-width: 480px) {
  .header-actions .el-button span { display: none; }
  .header-actions .el-button .el-icon { margin-right: 0 !important; }
  
  /* 统计卡片 2行布局 */
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .stat-card:nth-child(5) {
    grid-column: 1 / -1; /* 第5个卡片占满整行 */
  }
  
  .tips-list { flex-direction: column; }
  .tip-tag { text-align: center; }
}
</style>
