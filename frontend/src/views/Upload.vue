<template>
  <div class="upload-page theme-v3">
    <!-- 授权页 -->
    <div v-if="!authorized" class="auth-container">
      <div class="auth-card">
        <aside class="auth-brand-pane">
          <div>
            <div class="auth-brand-mark">文件<br />空间</div>
            <p class="auth-brand-tagline">您的专属云端文件空间，安全、简洁、随时可用。</p>
          </div>
          <ul class="auth-brand-features">
            <li>拖拽上传</li>
            <li>在线编辑</li>
            <li>批量管理</li>
          </ul>
          <div class="auth-brand-edition">文件空间 · 3.0</div>
        </aside>
        <div class="auth-form-pane">
          <template v-if="authBlocked === 'disabled'">
            <div class="auth-blocked-icon"><el-icon><WarningFilled /></el-icon></div>
            <h2 class="auth-title">服务已停用</h2>
            <p class="auth-blocked-desc">访问权限已关闭，请联系管理员续费或处理后再试。</p>
            <p v-if="blockedDomain" class="auth-blocked-domain">{{ blockedDomain }}</p>
            <el-button type="primary" size="large" class="auth-primary-btn" @click="showContactDialog = true">
              <el-icon style="margin-right:6px"><Service /></el-icon>联系管理员
            </el-button>
            <el-button size="large" link @click="resetAuthBlocked" style="margin-top:12px">更换授权码</el-button>
          </template>
          <template v-else>
            <h2 class="auth-title">欢迎回来</h2>
            <p class="auth-subtitle">输入授权码进入您的文件空间</p>
            <el-input v-model="authCode" placeholder="请输入授权码" size="large" class="auth-input" @keyup.enter="verifyAuth">
              <template #prefix><el-icon><Key /></el-icon></template>
            </el-input>
            <el-button type="primary" size="large" class="auth-primary-btn" @click="verifyAuth" :loading="verifying">
              进入空间
            </el-button>
            <p class="auth-hint">没有授权码？请联系管理员获取</p>
          </template>
        </div>
      </div>
      <div class="auth-contact" @click="showContactDialog = true">
        <el-icon><Service /></el-icon>
        <span>联系客服</span>
      </div>
    </div>

    <!-- 文件管理工作区 -->
    <div v-else class="workspace">
      <header class="top-bar">
        <div class="top-bar-brand">
          <div class="brand-logo"><el-icon><FolderOpened /></el-icon></div>
          <div class="brand-text">
            <div class="brand-name">文件空间</div>
            <div class="brand-domain" @click="copyDomain" title="点击复制">
              {{ siteUrl }}
              <el-icon style="font-size:13px"><DocumentCopy /></el-icon>
            </div>
          </div>
        </div>
        <div class="top-bar-actions">
          <el-button @click="logout"><span class="btn-text">退出</span></el-button>
        </div>
      </header>

      <div v-if="isPageDragOver" class="page-drag-overlay">
        <div class="page-drag-tip">松开鼠标添加文件</div>
      </div>

      <!-- 续费提醒 -->
      <div v-if="showRenewAlert" class="renew-banner" :class="{ 'is-expired': isExpired }">
        <el-icon class="renew-banner-icon"><WarningFilled v-if="isExpired" /><Clock v-else /></el-icon>
        <div class="renew-banner-body">
          <div class="renew-banner-title">{{ isExpired ? '服务已过期' : '服务即将到期' }}</div>
          <div class="renew-banner-text">
            <template v-if="isExpired">请尽快联系客服续费，避免影响使用。</template>
            <template v-else>还剩 <em>{{ remainingDays }}</em> 天 · 到期 {{ formatExpireDate(expireAt) }}</template>
          </div>
        </div>
        <el-button type="primary" @click="showContactDialog = true">立即续费</el-button>
      </div>

      <div class="workspace-grid">
        <!-- 左侧指标栏 -->
        <aside class="side-panel">
          <div class="side-summary">
            <div class="side-summary-block">
              <div class="side-summary-head">
                <span>存储</span>
                <span class="side-summary-mono">{{ formatSize(usedSize) }} / {{ formatSize(maxUploadSize) }}</span>
              </div>
              <el-progress :percentage="storagePercent" :status="storageStatus" :stroke-width="4" :show-text="false" class="side-summary-progress" />
              <div class="side-summary-foot">{{ storagePercent }}% 已用</div>
            </div>
            <div class="side-summary-divider" />
            <div class="side-summary-inline">
              <span><strong>{{ fileCount }}</strong> 文件</span>
              <span><strong>{{ folderCount }}</strong> 文件夹</span>
            </div>
            <div class="side-summary-divider" />
            <div class="side-summary-head">
              <span>有效期</span>
              <span class="side-expiry" :class="{
                'is-teal': remainingDays === null || remainingDays > 7,
                'is-warn': remainingDays !== null && remainingDays > 0 && remainingDays <= 7,
                'is-danger': remainingDays !== null && remainingDays <= 0
              }">{{ expiryLabel }}</span>
            </div>
            <div v-if="expiryHint" class="side-summary-foot">{{ expiryHint }}</div>
          </div>
          <div class="side-actions">
            <el-button type="primary" @click="showUploadDialog = true">
              <el-icon><Upload /></el-icon><span class="btn-text">上传</span>
            </el-button>
            <el-button @click="showContactDialog = true"><el-icon><Service /></el-icon><span class="btn-text">客服</span></el-button>
            <el-button @click="showTutorialDialog = true"><el-icon><QuestionFilled /></el-icon><span class="btn-text">教程</span></el-button>
            <el-button @click="openWebsite"><el-icon><Link /></el-icon><span class="btn-text">访问站</span></el-button>
          </div>
        </aside>

        <!-- 右侧文件区 -->
        <main class="file-panel">
          <div class="file-panel-header">
            <div class="file-panel-row">
              <div class="file-panel-nav">
                <div class="breadcrumb-wrap">
                  <nav class="breadcrumb">
                  <span class="breadcrumb-item" @click="navigateTo('')"><el-icon style="vertical-align:-2px"><HomeFilled /></el-icon> 根目录</span>
                  <span v-for="(part, index) in pathParts" :key="index">
                    <span class="breadcrumb-sep">/</span>
                    <span class="breadcrumb-item" @click="navigateTo(pathParts.slice(0, index + 1).join('/'))">{{ part }}</span>
                  </span>
                </nav>
                  <button
                    type="button"
                    class="nav-back-btn"
                    :class="{ 'is-disabled': !currentPath }"
                    :disabled="!currentPath"
                    title="返回上级目录"
                    @click="goBack"
                  >
                    <el-icon><ArrowLeft /></el-icon>
                  </button>
                </div>
              </div>
              <div class="file-actions-bar">
                <el-radio-group v-model="viewMode" size="small">
                  <el-radio-button value="list"><el-icon><List /></el-icon></el-radio-button>
                  <el-radio-button value="grid"><el-icon><Grid /></el-icon></el-radio-button>
                </el-radio-group>
                <el-button @click="showMkdirDialog = true" size="small"><el-icon><FolderAdd /></el-icon></el-button>
                <el-button @click="openNewFileDialog" size="small"><el-icon><Document /></el-icon></el-button>
                <el-tooltip content="刷新" placement="top">
                  <el-button @click="loadFiles(false)" :loading="loading" circle size="small"><el-icon><Refresh /></el-icon></el-button>
                </el-tooltip>
              </div>
            </div>
            <div
              class="file-panel-toolbar"
              :class="{ 'is-batch-active': selectedFiles.length > 0 || clipboard.files.length > 0 }"
            >
              <div class="file-search-bar" :class="{ 'is-active': searchKeyword.trim() }">
                <el-input
                  v-model="searchKeyword"
                  :placeholder="searchSubdirs ? '搜索当前目录及子文件夹…' : '搜索当前目录…'"
                  clearable
                  size="small"
                  class="file-search-input"
                >
                  <template #prefix>
                    <el-icon><Search /></el-icon>
                  </template>
                </el-input>
                <label class="file-search-option">
                  <el-switch v-model="searchSubdirs" size="small" />
                  <span>包含子文件夹</span>
                </label>
              </div>
              <p v-if="searchTruncated" class="file-search-notice">匹配结果过多，仅显示前 2000 条</p>
              <div
                class="batch-operations"
                :class="{ 'is-active': selectedFiles.length > 0 || clipboard.files.length > 0 }"
              >
              <template v-if="files.length > 0">
                <el-button size="small" class="batch-select-btn" @click="selectAll" v-if="selectedFiles.length < files.length">全选</el-button>
                <el-button size="small" class="batch-select-btn" @click="clearSelection" v-else>取消全选</el-button>
              </template>
              <template v-if="selectedFiles.length > 0 || clipboard.files.length > 0">
                <span class="batch-label">
                  <template v-if="selectedFiles.length > 0">已选 {{ selectedFiles.length }} 项</template>
                  <template v-else>剪贴板 {{ clipboard.files.length }} 项</template>
                </span>
                <div class="batch-actions">
                  <template v-if="selectedFiles.length > 0">
                    <el-button type="primary" size="small" @click="copyFiles">复制</el-button>
                    <el-button type="warning" size="small" @click="cutFiles">剪切</el-button>
                    <el-button type="success" size="small" @click="compressFiles">压缩</el-button>
                    <el-button size="small" :disabled="selectedDirectories.length === 0" @click="liftSelectedFolders">
                      <el-icon style="margin-right:4px"><Top /></el-icon>提取到上级
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteSelected">删除</el-button>
                    <el-button size="small" @click="clearSelection">取消</el-button>
                  </template>
                  <el-divider
                    v-if="selectedFiles.length > 0 && clipboard.files.length > 0"
                    direction="vertical"
                    class="batch-divider"
                  />
                  <template v-if="clipboard.files.length > 0">
                    <el-button type="success" size="small" @click="pasteFiles">
                      粘贴 ({{ clipboard.files.length }})
                    </el-button>
                    <el-button size="small" text @click="clearClipboard">清空剪贴板</el-button>
                  </template>
                </div>
              </template>
            </div>
            </div>
          </div>

          <div
            class="file-list"
            :class="{
              'drag-over': isFileDragOver,
              'empty-list': files.length === 0
            }"
            v-loading="loading"
            @dragover.prevent="handleFileDragOver"
            @dragleave="handleFileDragLeave"
            @drop.prevent="handleFileListDrop"
          >
          <!-- 列表视图 -->
          <template v-if="viewMode === 'list'">
            <div v-for="file in files" :key="fileKey(file)" class="file-item"
                 :class="{ selected: isSelected(file), 'ctx-target': contextMenu.file && fileKey(contextMenu.file) === fileKey(file) && contextMenu.visible }"
                 @click="handleFileClick($event, file)"
                 @contextmenu.capture.prevent="showContextMenu($event, file)">
              <div class="file-checkbox" @click.stop>
                <el-checkbox :model-value="isSelected(file)" @change="toggleSelect(file)" />
              </div>
              <div class="file-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</div>
              <div class="file-info">
                <div class="file-name">{{ file.name }}</div>
                <div class="file-meta">
                  <span v-if="showSearchLocation" class="file-path-hint">{{ fileParentHint(file) }}</span>
                  <span v-else-if="file.type === 'directory'" class="file-type-label">文件夹</span>
                </div>
              </div>
              <div v-if="file.type === 'file'" class="file-size-col">{{ formatSize(file.size) }}</div>
              <div v-else class="file-size-col">-</div>
              <div class="file-date-col">{{ formatDate(file.date) }}</div>
              <div class="file-actions" @click.stop>
                <button
                  v-if="file.type === 'file'"
                  type="button"
                  class="file-action-visit"
                  @click="openFileUrl(file)"
                >
                  <el-icon><Link /></el-icon>
                  <span>访问</span>
                </button>
                <el-dropdown trigger="click" popper-class="loft-file-dropdown">
                  <button type="button" class="file-action-trigger">
                    <span>操作</span>
                    <el-icon><ArrowDown /></el-icon>
                  </button>
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
                      <template v-if="file.type === 'directory'">
                        <el-dropdown-item @click="enterFolder(file)">
                          <el-icon><FolderOpened /></el-icon>打开文件夹
                        </el-dropdown-item>
                        <el-dropdown-item @click="liftFolderContents(file)">
                          <el-icon><Top /></el-icon>提取到上级目录
                        </el-dropdown-item>
                        <el-dropdown-item @click="emptyFolder(file)">
                          <el-icon><Delete /></el-icon>清空文件夹
                        </el-dropdown-item>
                      </template>
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
                      <el-dropdown-item @click="copyFilePath(file)">
                        <el-icon><Link /></el-icon>复制路径
                      </el-dropdown-item>
                      <el-dropdown-item divided class="loft-dd-danger" @click="deleteFile(file)">
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
              <div v-for="file in files" :key="fileKey(file)" class="grid-item"
                   :class="{ selected: isSelected(file), 'ctx-target': contextMenu.file && fileKey(contextMenu.file) === fileKey(file) && contextMenu.visible }"
                   @click="handleGridClick($event, file)"
                   @contextmenu.capture.prevent="showContextMenu($event, file)">
                <div class="grid-checkbox" @click.stop>
                  <el-checkbox :model-value="isSelected(file)" @change="toggleSelect(file)" />
                </div>
                <div class="grid-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</div>
                <div class="grid-name" :title="fileRelPath(file)">{{ file.name }}</div>
                <div v-if="showSearchLocation" class="grid-path">{{ fileParentHint(file) }}</div>
                <div v-if="file.type === 'file'" class="grid-size">{{ formatSize(file.size) }}</div>
                <el-dropdown trigger="click" class="grid-more" popper-class="loft-file-dropdown" @click.stop>
                  <button type="button" class="file-action-trigger is-icon" @click.stop>
                    <el-icon><MoreFilled /></el-icon>
                  </button>
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
                      <template v-if="file.type === 'directory'">
                        <el-dropdown-item @click="enterFolder(file)">
                          <el-icon><FolderOpened /></el-icon>打开文件夹
                        </el-dropdown-item>
                        <el-dropdown-item @click="liftFolderContents(file)">
                          <el-icon><Top /></el-icon>提取到上级目录
                        </el-dropdown-item>
                        <el-dropdown-item @click="emptyFolder(file)">
                          <el-icon><Delete /></el-icon>清空文件夹
                        </el-dropdown-item>
                      </template>
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
                      <el-dropdown-item @click="copyFilePath(file)">
                        <el-icon><Link /></el-icon>复制路径
                      </el-dropdown-item>
                      <el-dropdown-item divided class="loft-dd-danger" @click="deleteFile(file)">
                        <el-icon><Delete /></el-icon>删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>

          <div v-if="!loading && files.length === 0" class="empty-tip">
            <template v-if="searchKeyword.trim()">
              <div class="empty-icon">🔍</div>
              <p style="font-size:16px;margin-bottom:10px">未找到匹配的文件</p>
              <p class="empty-hint">关键词「{{ searchKeyword.trim() }}」{{ searchSubdirs ? '在子文件夹中' : '在当前目录' }}无结果</p>
              <div class="quick-actions">
                <el-button @click="clearSearch">清除搜索</el-button>
              </div>
            </template>
            <template v-else>
              <div class="empty-icon">📂</div>
              <p style="font-size:16px;margin-bottom:10px">当前目录为空</p>
              <p class="empty-hint">拖拽文件到页面任意位置 · 点击上传 · 或 Ctrl+V 粘贴</p>
              <div class="quick-actions">
                <el-button type="primary" @click="showUploadDialog = true">上传文件</el-button>
                <el-button @click="showMkdirDialog = true">新建文件夹</el-button>
              </div>
            </template>
          </div>
          </div>

          <div v-if="totalFiles > 0" class="file-pagination">
            <el-pagination
              :current-page="currentPage"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50]"
              :total="totalFiles"
              layout="total, sizes, prev, pager, next"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </main>
      </div>

      <footer class="workspace-footer">
        文件空间 <span class="version">3.0</span>
      </footer>

      <!-- 上传对话框 -->
      <el-dialog
        v-model="showUploadDialog"
        class="upload-dialog upload-theme-dialog"
        width="560px"
        align-center
        :fullscreen="isMobile"
        append-to-body
        :close-on-click-modal="!uploading"
        :before-close="handleUploadDialogClose"
      >
        <template #header>
          <div class="upload-dialog-header">
            <span class="upload-dialog-title">上传文件</span>
            <el-tag v-if="directUploadOk" type="success" size="small" effect="plain">直传</el-tag>
            <el-tag v-else type="info" size="small" effect="plain">中转</el-tag>
          </div>
        </template>
        <div class="upload-dialog-body">
          <input ref="fileInputRef" type="file" multiple hidden @change="handleFileSelect">
          <input ref="folderInputRef" type="file" webkitdirectory hidden @change="handleFolderSelect">
          <!-- 大上传区：仅队列为空时显示 -->
          <div v-if="!uploading && uploadQueue.length === 0" class="upload-area" :class="{ dragover: isDragover }" @dragenter.prevent="handleUploadAreaDragEnter" @dragover.prevent="handleUploadAreaDragOver" @dragleave="handleUploadAreaDragLeave" @drop.prevent="handleDrop">
            <el-icon class="upload-area-icon"><Upload /></el-icon>
            <div class="upload-text">拖拽文件或文件夹到此处</div>
            <el-dropdown trigger="click" popper-class="loft-file-dropdown" @command="handleUploadCommand">
              <el-button type="primary" size="default">选择文件/文件夹</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="file"><el-icon><Document /></el-icon> 选择文件</el-dropdown-item>
                  <el-dropdown-item command="folder"><el-icon><Folder /></el-icon> 选择文件夹</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div class="upload-hint">剩余 {{ formatSize(Math.max(0, maxUploadSize - usedSize)) }} · Ctrl+V 粘贴</div>
          </div>
          <!-- 已有文件：紧凑添加条 -->
          <div v-if="!uploading && uploadQueue.length > 0" class="upload-add-strip" :class="{ dragover: isDragover }" @dragenter.prevent="handleUploadAreaDragEnter" @dragover.prevent="handleUploadAreaDragOver" @dragleave="handleUploadAreaDragLeave" @drop.prevent="handleDrop">
            <el-icon><Upload /></el-icon>
            <span>继续添加：</span>
            <el-dropdown trigger="click" popper-class="loft-file-dropdown" @command="handleUploadCommand">
              <el-button type="primary" link size="small">选择文件</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="file"><el-icon><Document /></el-icon> 选择文件</el-dropdown-item>
                  <el-dropdown-item command="folder"><el-icon><Folder /></el-icon> 选择文件夹</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <span class="upload-add-strip-or">或拖拽到此处</span>
          </div>

          <template v-if="uploadQueue.length > 0">
            <div class="upload-toolbar">
              <span>{{ uploadQueue.length }} 个文件 · {{ formatSize(uploadQueueStats.totalBytes) }}</span>
              <div class="upload-queue-actions">
                <el-button v-if="uploadQueueStats.done > 0 && !uploading" size="small" link @click="clearCompletedUploads">清除已完成</el-button>
                <el-button v-if="!uploading" type="danger" size="small" link @click="uploadQueue = []">清空</el-button>
              </div>
            </div>
            <div class="upload-overall-progress">
              <div class="upload-overall-header">
                <span>{{ uploading ? '上传中' : '待上传' }} {{ uploadQueueStats.done }}/{{ uploadQueueStats.total }}</span>
                <span v-if="uploading">{{ overallUploadProgress }}%</span>
              </div>
              <el-progress :percentage="overallUploadProgress" :stroke-width="6" :show-text="false" :status="uploadQueueStats.error > 0 && !uploading ? 'exception' : (overallUploadProgress === 100 && !uploading ? 'success' : '')" />
            </div>
            <div v-if="uploading && uploadStats.startTime" class="upload-stats-bar">
              <span>⏱ {{ formatDuration(uploadStats.duration) }}</span>
              <span>📊 {{ formatSize(uploadStats.uploadedBytes) }}</span>
              <span>🚀 {{ formatSize(uploadStats.speed) }}/s</span>
            </div>
            <div class="upload-queue-list">
              <div v-for="(item, index) in uploadQueue" :key="index" class="upload-queue-item">
                <span class="upload-item-icon">{{ getFileIcon(item.name) }}</span>
                <div class="upload-item-info">
                  <div class="upload-item-name">{{ item.name }}</div>
                  <div v-if="item.relativePath" class="upload-item-path">{{ item.relativePath }}</div>
                  <div v-if="item.status === 'error' && item.errorMessage" class="upload-item-error">{{ item.errorMessage }}</div>
                  <div v-if="item.status === 'uploading'" class="upload-item-progress">
                    <el-progress :percentage="item.progress || 0" :stroke-width="4" :show-text="false" />
                    <span class="upload-item-step">{{ item.stepLabel }}<template v-if="item.step === 1 && item.eta"> · {{ item.speed }} · 剩余 {{ item.eta }}</template></span>
                  </div>
                </div>
                <span class="upload-item-size">{{ formatSize(item.file.size) }}</span>
                <el-tag class="upload-item-tag" :type="item.status === 'done' ? 'success' : item.status === 'error' ? 'danger' : item.status === 'uploading' ? 'warning' : 'info'" size="small">
                  {{ item.status === 'done' ? '完成' : item.status === 'error' ? '失败' : item.status === 'uploading' ? (item.progress + '%') : '等待' }}
                </el-tag>
                <el-button v-if="item.status === 'pending'" type="danger" size="small" link @click="uploadQueue.splice(index, 1)"><el-icon><Close /></el-icon></el-button>
                <el-button v-if="item.status === 'uploading' && item.uploader" type="danger" size="small" link @click="cancelUpload(item)" title="取消"><el-icon><Close /></el-icon></el-button>
                <el-button v-if="item.status === 'error'" type="primary" size="small" link @click="retryUpload(item)" title="重试"><el-icon><Refresh /></el-icon></el-button>
              </div>
            </div>
          </template>
        </div>
        <template #footer>
          <div class="upload-dialog-footer">
            <el-checkbox v-model="autoStartUpload" :disabled="uploading" size="small">添加后自动上传</el-checkbox>
            <div class="upload-dialog-footer-btns">
              <el-button v-if="uploadQueueStats.error > 0 && !uploading" type="warning" size="small" @click="retryAllFailed">
                重试失败 ({{ uploadQueueStats.error }})
              </el-button>
              <el-button size="small" @click="uploading ? (showUploadDialog = false) : handleUploadDialogClose(() => { showUploadDialog = false })">
                {{ uploading ? '最小化' : '关闭' }}
              </el-button>
              <el-button type="primary" size="small" @click="startUpload" :loading="uploading" :disabled="uploadQueueStats.pending === 0">
                {{ uploading ? '上传中...' : `开始上传 (${uploadQueueStats.pending})` }}
              </el-button>
            </div>
          </div>
        </template>
      </el-dialog>

      <!-- 上传进度浮窗（对话框最小化后仍可见） -->
      <Transition name="slide-up">
        <div v-if="showUploadFloat" class="upload-float-panel" @click="showUploadDialog = true">
          <div class="upload-float-content">
            <div class="upload-float-info">
              <span class="upload-float-title">{{ uploading ? '上传中' : '待上传' }}</span>
              <span class="upload-float-detail">{{ uploadQueueStats.done }}/{{ uploadQueueStats.total }} · {{ overallUploadProgress }}%</span>
            </div>
            <el-progress :percentage="overallUploadProgress" :stroke-width="4" :show-text="false" style="flex:1;margin:0 12px" />
            <el-button type="primary" size="small" round @click.stop="showUploadDialog = true">查看</el-button>
          </div>
        </div>
      </Transition>

      <!-- 新建文件夹对话框 -->
      <el-dialog v-model="showMkdirDialog" title="新建文件夹" width="400px" :fullscreen="isMobile" append-to-body class="upload-theme-dialog">
        <el-input v-model="newFolderName" placeholder="请输入文件夹名称" size="large" @keyup.enter="createFolder">
          <template #prefix><el-icon><Folder /></el-icon></template>
        </el-input>
        <template #footer>
          <el-button @click="showMkdirDialog = false">取消</el-button>
          <el-button type="primary" @click="createFolder" :loading="creating">创建</el-button>
        </template>
      </el-dialog>

      <!-- 新建文件对话框 -->
      <el-dialog v-model="showNewFileDialog" title="新建文件" width="600px" :fullscreen="isMobile" append-to-body class="upload-theme-dialog">
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
                <span class="dialog-input-suffix">.{{ newFileType }}</span>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="使用模板">
            <el-switch v-model="useTemplate" :disabled="!hasTemplate" />
            <span v-if="hasTemplate" class="dialog-form-hint">使用 {{ newFileType.toUpperCase() }} 基础模板</span>
            <span v-else class="dialog-form-hint is-muted">该类型暂无模板</span>
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
      <el-dialog v-model="showRenameDialog" title="重命名" width="400px" :fullscreen="isMobile" append-to-body class="upload-theme-dialog">
        <el-input v-model="newFileName" placeholder="请输入新名称" size="large" @keyup.enter="renameFile">
          <template #prefix><el-icon><EditPen /></el-icon></template>
        </el-input>
        <template #footer>
          <el-button @click="showRenameDialog = false">取消</el-button>
          <el-button type="primary" @click="renameFile" :loading="renaming">确定</el-button>
        </template>
      </el-dialog>

      <!-- 文件编辑对话框 -->
      <el-dialog v-model="showEditDialog" :title="'编辑文件: ' + editingFile?.name" width="900px" top="5vh" :close-on-click-modal="false" :fullscreen="isMobile" append-to-body class="upload-theme-dialog">
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
      <el-dialog v-model="showPreviewDialog" :title="'预览: ' + previewingFile?.name" width="auto" top="5vh" :fullscreen="isMobile" append-to-body class="upload-theme-dialog">
        <div style="text-align:center;max-height:80vh;overflow:auto">
          <img v-if="previewType === 'image'" :src="previewUrl" style="max-width:100%;max-height:75vh" />
        </div>
      </el-dialog>

      <!-- 使用教程对话框 -->
      <el-dialog v-model="showTutorialDialog" title="上传教程" width="780px" align-center :fullscreen="isMobile" append-to-body class="help-dialog upload-theme-dialog">
        <div class="help-compact">
          <div class="help-rule-bar">
            <span class="help-rule-key">index.html 必须在网站根目录</span>
            <span class="help-rule-domain">您的域名：<code>{{ domain || 'yourdomain.com' }}</code></span>
          </div>

          <div class="help-steps-inline">
            <div class="help-step-pill"><span>1</span>确认结构</div>
            <div class="help-step-arrow">→</div>
            <div class="help-step-pill"><span>2</span>拖到页面任意位置</div>
            <div class="help-step-arrow">→</div>
            <div class="help-step-pill"><span>3</span>检查路径</div>
            <div class="help-step-arrow">→</div>
            <div class="help-step-pill"><span>4</span>访问网站</div>
          </div>

          <div class="help-main-grid">
            <div class="help-tree-card help-tree-good">
              <div class="help-tree-badge">✅ 正确</div>
              <div class="help-tree help-tree-sm">
                <div class="help-tree-line help-tree-root">📁 根目录</div>
                <div class="help-tree-line"><span class="help-tree-branch">├──</span> <span class="help-tree-highlight">index.html</span></div>
                <div class="help-tree-line"><span class="help-tree-branch">├──</span> css/</div>
                <div class="help-tree-line"><span class="help-tree-branch">└──</span> js/</div>
              </div>
              <div class="help-tree-foot">列表显示 <code>index.html</code></div>
            </div>

            <div class="help-tree-card help-tree-bad">
              <div class="help-tree-badge">❌ 多套一层</div>
              <div class="help-tree help-tree-sm">
                <div class="help-tree-line help-tree-root">📁 根目录</div>
                <div class="help-tree-line"><span class="help-tree-branch">└──</span> my-site/ <span class="help-tree-warn">多一层</span></div>
                <div class="help-tree-line"><span class="help-tree-branch">&nbsp;&nbsp;&nbsp;&nbsp;</span> └── index.html</div>
              </div>
              <div class="help-tree-foot">拖入外层文件夹导致，应拖<strong>内部文件</strong></div>
            </div>

            <div class="help-tree-card help-tree-bad">
              <div class="help-tree-badge">❌ 首页在子目录</div>
              <div class="help-tree help-tree-sm">
                <div class="help-tree-line help-tree-root">📁 根目录</div>
                <div class="help-tree-line"><span class="help-tree-branch">├──</span> src/</div>
                <div class="help-tree-line"><span class="help-tree-branch">└──</span> dist/ <span class="help-tree-warn">网站在这</span></div>
                <div class="help-tree-line"><span class="help-tree-branch">&nbsp;&nbsp;&nbsp;&nbsp;</span> └── index.html</div>
              </div>
              <div class="help-tree-foot">只上传 <strong>dist 里的内容</strong>，不传 src 等</div>
            </div>
          </div>

          <div class="help-bottom-row">
            <div class="help-path-mini help-path-good">
              <span class="help-path-mini-label">✅ 路径正确</span>
              <code>index.html</code> · <code>css/style.css</code>
            </div>
            <div class="help-path-mini help-path-bad">
              <span class="help-path-mini-label">❌ 路径错误</span>
              <code>my-website/index.html</code>
            </div>
          </div>

          <div class="help-footnote">
            <code>index.html</code> 全小写 · 支持 HTML/CSS/JS/图片 · 可拖到页面任意位置上传
          </div>
        </div>
        <template #footer>
          <el-button @click="showTutorialDialog = false">关闭</el-button>
          <el-button type="primary" @click="showTutorialDialog = false; showUploadDialog = true">
            <el-icon style="margin-right:5px"><Upload /></el-icon>立即上传
          </el-button>
        </template>
      </el-dialog>
    </div>

    <!-- 联系客服对话框（放在外层，授权页面也能访问） -->
    <el-dialog
      v-model="showContactDialog"
      width="480px"
      :fullscreen="isMobile"
      append-to-body
      class="contact-dialog upload-theme-dialog"
      :show-close="true"
    >
      <template #header>
        <div class="contact-dialog-header">
          <div class="contact-dialog-icon">
            <el-icon><Service /></el-icon>
          </div>
          <div>
            <div class="contact-dialog-title">联系客服</div>
            <div class="contact-dialog-subtitle">续费、咨询、技术支持</div>
          </div>
        </div>
      </template>
      <div class="contact-content">
        <div class="contact-card">
          <div class="contact-qrcode-section">
            <div class="qrcode-frame">
              <img src="/wechat-qrcode.png" alt="微信二维码" class="qrcode-img" />
            </div>
            <p class="qrcode-tip">微信扫码添加客服</p>
          </div>
          <div class="contact-divider">
            <span>或</span>
          </div>
          <div class="contact-wechat-section">
            <div class="wechat-id-row">
              <div class="wechat-id-info">
                <span class="wechat-label">微信号</span>
                <span class="wechat-id">feiyu3305</span>
              </div>
              <el-button type="primary" round @click="copyWechat" class="wechat-copy-btn">
                <el-icon><DocumentCopy /></el-icon>
                复制
              </el-button>
            </div>
            <p class="contact-desc">添加后请备注您的域名，方便快速处理</p>
          </div>
        </div>
        <div class="contact-footer">
          <el-icon class="contact-footer-icon"><Clock /></el-icon>
          <span>服务时间：周一至周日 9:00 – 22:00</span>
        </div>
      </div>
    </el-dialog>

    <!-- 到期提醒弹框（3 天内每次进入） -->
    <el-dialog
      v-model="showExpiryAlertDialog"
      width="440px"
      align-center
      append-to-body
      class="expiry-alert-dialog upload-theme-dialog"
      :close-on-click-modal="false"
      @closed="onExpiryAlertClosed"
    >
      <template #header>
        <div class="expiry-alert-header">
          <div class="expiry-alert-icon" :class="{ 'is-expired': isExpired }">
            <el-icon><WarningFilled v-if="isExpired" /><Clock v-else /></el-icon>
          </div>
          <div>
            <div class="expiry-alert-title">{{ isExpired ? '服务已过期' : '服务即将到期' }}</div>
            <div class="expiry-alert-subtitle">请及时续费，避免影响使用</div>
          </div>
        </div>
      </template>
      <div class="expiry-alert-body">
        <p v-if="isExpired" class="expiry-alert-text">
          您的文件空间已过期，请尽快联系客服续费。
        </p>
        <p v-else class="expiry-alert-text">
          还剩 <strong>{{ remainingDays }}</strong> 天到期（{{ formatExpireDate(expireAt) }}），请提前续费。
        </p>
        <label class="expiry-alert-dismiss">
          <el-checkbox v-model="expiryAlertDontShow">不再弹框提示</el-checkbox>
        </label>
      </div>
      <template #footer>
        <el-button @click="closeExpiryAlertDialog">我知道了</el-button>
        <el-button type="primary" @click="openRenewFromExpiryAlert">联系客服续费</el-button>
      </template>
    </el-dialog>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="loft-ctx">
        <nav
          v-if="contextMenu.visible && contextMenu.file"
          class="loft-context-menu"
          :style="contextMenuStyle"
          role="menu"
          @mousedown.stop
          @contextmenu.prevent
        >
          <div class="loft-ctx-header">
            <span class="loft-ctx-header-name" :title="contextMenu.file.name">{{ contextMenu.file.name }}</span>
          </div>

          <div class="loft-ctx-body">
            <template v-if="contextMenu.file.type === 'directory'">
              <button type="button" class="loft-ctx-item" @click="runCtx(enterFolder, contextMenu.file)">
                <el-icon><FolderOpened /></el-icon>
                <span>打开文件夹</span>
              </button>
              <button type="button" class="loft-ctx-item" @click="runCtx(liftFolderContents, contextMenu.file)">
                <el-icon><Top /></el-icon>
                <span>提取到上级目录</span>
              </button>
              <button type="button" class="loft-ctx-item" @click="runCtx(emptyFolder, contextMenu.file)">
                <el-icon><Delete /></el-icon>
                <span>清空文件夹</span>
              </button>
            </template>
            <template v-else>
              <button type="button" class="loft-ctx-item" @click="runCtx(openFileUrl, contextMenu.file)">
                <el-icon><Link /></el-icon>
                <span>访问地址</span>
              </button>
              <button
                v-if="isEditableFile(contextMenu.file.name)"
                type="button"
                class="loft-ctx-item"
                @click="runCtx(openFile, contextMenu.file)"
              >
                <el-icon><Edit /></el-icon>
                <span>编辑</span>
              </button>
              <button
                v-if="isPreviewableFile(contextMenu.file.name)"
                type="button"
                class="loft-ctx-item"
                @click="runCtx(previewFile, contextMenu.file)"
              >
                <el-icon><View /></el-icon>
                <span>预览</span>
              </button>
              <button
                v-if="isCompressedFile(contextMenu.file.name)"
                type="button"
                class="loft-ctx-item"
                @click="runCtx(extractFile, contextMenu.file)"
              >
                <el-icon><FolderOpened /></el-icon>
                <span>解压到当前目录</span>
              </button>
            </template>

            <div class="loft-ctx-divider" />

            <button type="button" class="loft-ctx-item" @click="runCtx(compressSingleFile, contextMenu.file)">
              <el-icon><Files /></el-icon>
              <span>压缩</span>
            </button>
            <button type="button" class="loft-ctx-item" @click="runCtx(copySingleFile, contextMenu.file)">
              <el-icon><DocumentCopy /></el-icon>
              <span>复制</span>
            </button>
            <button type="button" class="loft-ctx-item" @click="runCtx(cutSingleFile, contextMenu.file)">
              <el-icon><Scissor /></el-icon>
              <span>剪切</span>
            </button>

            <div class="loft-ctx-divider" />

            <button type="button" class="loft-ctx-item" @click="runCtx(openRenameDialog, contextMenu.file)">
              <el-icon><EditPen /></el-icon>
              <span>重命名</span>
            </button>
            <button type="button" class="loft-ctx-item" @click="runCtx(copyFilePath, contextMenu.file)">
              <el-icon><Link /></el-icon>
              <span>复制路径</span>
            </button>

            <div class="loft-ctx-divider" />

            <button type="button" class="loft-ctx-item is-danger" @click="runCtx(deleteFile, contextMenu.file)">
              <el-icon><Delete /></el-icon>
              <span>删除</span>
            </button>
          </div>
        </nav>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Link, HomeFilled, Upload, FolderAdd, Refresh, Delete, Close, Edit, View, ArrowDown, ArrowLeft, Document, Folder, QuestionFilled, Service, DocumentCopy, InfoFilled, Star, Promotion, EditPen, List, Grid, MoreFilled, FolderOpened, Scissor, Files, WarningFilled, Clock, CircleCheck, Top, Search } from '@element-plus/icons-vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { ChunkedUploader } from '@/utils/chunked-upload'
import { PhpDirectUploader } from '@/utils/php-direct-upload'
import { API_BASE } from '@/config'
import '@/styles/upload-theme-v3.css'

if (typeof document !== 'undefined') {
  document.body.classList.add('upload-theme-page')
}

const authCode = ref(localStorage.getItem('upload_auth_code') || '')
const authorized = ref(false)
const verifying = ref(false)
const authBlocked = ref(null)
const blockedDomain = ref('')
const domain = ref('')
const homeDir = ref('')
const maxUploadSize = ref(209715200)
// PHP 直传配置
const directConfig = ref(null)
const directUploadOk = ref(false)
const usedSize = ref(0)
const expireAt = ref(null)
const remainingDays = ref(null)
const windowWidth = ref(window.innerWidth)
const isMobile = computed(() => windowWidth.value < 768)
const selectedDirectories = computed(() => selectedFiles.value.filter(f => f.type === 'directory'))
const parentPathLabel = computed(() => currentPath.value || '根目录')

const contextMenu = ref({ visible: false, x: 0, y: 0, file: null })
const contextMenuStyle = computed(() => ({
  left: `${contextMenu.value.x}px`,
  top: `${contextMenu.value.y}px`
}))

const hideContextMenu = () => {
  contextMenu.value.visible = false
}

const showContextMenu = (e, file) => {
  e.preventDefault()
  e.stopPropagation()
  const pad = 10
  const menuW = 180
  const menuH = 320
  let x = e.clientX
  let y = e.clientY
  if (x + menuW + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - menuW - pad)
  if (y + menuH + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - menuH - pad)
  contextMenu.value = { visible: true, x, y, file }
}

const runCtx = (handler, file) => {
  hideContextMenu()
  if (file && handler) handler(file)
}

const onContextMenuDismiss = (e) => {
  const menu = document.querySelector('.loft-context-menu')
  if (menu && menu.contains(e.target)) return
  hideContextMenu()
}
const onContextMenuKeydown = (e) => {
  if (e.key === 'Escape') hideContextMenu()
}

const currentPath = ref('')
const files = ref([])
const loading = ref(false)
const viewMode = ref('list')
const currentPage = ref(1)
const pageSize = ref(10)
const totalFiles = ref(0)
const totalFileCount = ref(0)
const totalFolderCount = ref(0)
const searchKeyword = ref('')
const searchSubdirs = ref(localStorage.getItem('upload_search_subdirs') === 'true')
const searchTruncated = ref(false)
let searchTimer = null
let skipSearchWatch = false

const fileKey = (file) => file.rel_path || file.name
const fileRelPath = (file) => file.rel_path ?? (currentPath.value ? `${currentPath.value}/${file.name}` : file.name)
const fileParentHint = (file) => {
  const rel = fileRelPath(file)
  const idx = rel.lastIndexOf('/')
  return idx > -1 ? rel.slice(0, idx) : '根目录'
}
const showSearchLocation = computed(() => !!searchKeyword.value.trim() && searchSubdirs.value)

// 多选相关
const selectedFiles = ref([])

// 剪贴板相关
const clipboard = ref({
  files: [],
  operation: '' // 'copy' 或 'cut'
})

const isSelected = (file) => {
  return selectedFiles.value.some(f => fileKey(f) === fileKey(file))
}

const toggleSelect = (file) => {
  const index = selectedFiles.value.findIndex(f => fileKey(f) === fileKey(file))
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
    navigateTo(fileRelPath(file))
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
    navigateTo(fileRelPath(file))
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
    const paths = selectedFiles.value.map(file => fileRelPath(file))
    const result = await api('/delete', { paths })
    ElMessage.success(`成功删除 ${result.deleted ?? paths.length} 个项目`)
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
      path: fileRelPath(f)
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
      path: fileRelPath(f)
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
        const targetPath = fileRelPath(file)
        
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

const enterFolder = (file) => {
  if (file.type !== 'directory') return
  navigateTo(fileRelPath(file))
}

const copyFilePath = async (file) => {
  try {
    await navigator.clipboard.writeText(fileRelPath(file))
    ElMessage.success('路径已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

const resolveLiftConflict = async (conflicts, parentLabel) => {
  const preview = conflicts.slice(0, 8).map(c => {
    const tag = c.type === 'directory' ? '文件夹' : '文件'
    return `· ${c.name}（${tag}）`
  }).join('\n')
  const more = conflicts.length > 8 ? `\n… 还有 ${conflicts.length - 8} 项` : ''

  try {
    await ElMessageBox.confirm(
      `「${parentLabel}」中已有 ${conflicts.length} 个同名项：\n\n${preview}${more}\n\n覆盖将删除上级目录中的同名项后再移动。`,
      '发现重名',
      {
        type: 'warning',
        confirmButtonText: '覆盖',
        cancelButtonText: '跳过重名项',
        distinguishCancelAndClose: true
      }
    )
    return 'overwrite'
  } catch (action) {
    if (action === 'cancel') return 'skip'
    return null
  }
}

const executeLiftContents = async (folderRelPath, folderName, { silent = false } = {}) => {
  const check = await api('/lift-contents/check', { path: folderRelPath })
  if (check.total === 0) {
    if (!silent) ElMessage.info(folderName ? `「${folderName}」已是空的` : '文件夹已是空的')
    return { ok: true, moved: 0, empty: true }
  }

  let onConflict = 'skip'
  if (check.conflicts?.length > 0) {
    const choice = await resolveLiftConflict(check.conflicts, parentPathLabel.value)
    if (!choice) return { ok: false, cancelled: true }
    onConflict = choice
  }

  const res = await api('/lift-contents', { path: folderRelPath, on_conflict: onConflict })
  if (!silent) {
    if (res.failed > 0) {
      ElMessage.warning(folderName ? `「${folderName}」：${res.message}` : res.message)
    } else {
      ElMessage.success(folderName ? `「${folderName}」：${res.message}` : res.message)
    }
  }
  return { ok: res.failed === 0, ...res }
}

const liftFolderContents = async (file) => {
  if (file.type !== 'directory') return
  try {
    await ElMessageBox.confirm(
      `将「${file.name}」内的所有内容移动到「${parentPathLabel.value}」。\n子文件夹会整体移动，不会递归拆散。`,
      '提取到上级目录',
      { type: 'info', confirmButtonText: '继续', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  const loadingMsg = ElMessage({ message: '正在提取...', type: 'info', duration: 0 })
  try {
    const result = await executeLiftContents(fileRelPath(file), file.name)
    loadingMsg.close()
    if (result.cancelled) return
    clearSelection()
    loadFiles()
  } catch (e) {
    loadingMsg.close()
    ElMessage.error(e.message)
  }
}

const liftSelectedFolders = async () => {
  const dirs = selectedDirectories.value
  if (dirs.length === 0) return
  try {
    await ElMessageBox.confirm(
      `将选中的 ${dirs.length} 个文件夹内的内容全部提取到「${parentPathLabel.value}」。`,
      '批量提取到上级',
      { type: 'info', confirmButtonText: '继续', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  const loadingMsg = ElMessage({ message: '正在批量提取...', type: 'info', duration: 0 })
  let moved = 0
  let failed = 0
  let cancelled = false
  try {
    for (const file of dirs) {
      const result = await executeLiftContents(fileRelPath(file), file.name, { silent: true })
      if (result.cancelled) {
        cancelled = true
        break
      }
      moved += result.moved || 0
      if (!result.ok && !result.cancelled) failed += 1
    }
    loadingMsg.close()
    if (cancelled) return
    if (failed === 0) {
      ElMessage.success(`已处理 ${dirs.length} 个文件夹，共提取 ${moved} 项`)
    } else {
      ElMessage.warning(`完成：${dirs.length - failed} 个成功，${failed} 个失败，共提取 ${moved} 项`)
    }
    clearSelection()
    loadFiles()
  } catch (e) {
    loadingMsg.close()
    ElMessage.error(e.message)
  }
}

const emptyFolder = async (file) => {
  if (file.type !== 'directory') return
  try {
    await ElMessageBox.confirm(
      `确定清空「${file.name}」内的所有内容？文件夹本身会保留。`,
      '清空文件夹',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  try {
    const res = await api('/empty-folder', { path: fileRelPath(file) })
    ElMessage.success(res.message)
    loadFiles()
  } catch (e) {
    ElMessage.error(e.message)
  }
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
      const paths = selectedFiles.value.map(f => fileRelPath(f))
      
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

const showExpiryAlertDialog = ref(false)
const expiryAlertDontShow = ref(false)
const EXPIRY_ALERT_DISMISS_KEY = 'upload_expiry_alert_dismiss'

// 是否显示续费提醒
const showRenewAlert = computed(() => isExpiringSoon.value || isExpired.value)

const getExpiryAlertDismissId = () => `${domain.value}|${expireAt.value || ''}`

const isExpiryAlertDismissed = () =>
  localStorage.getItem(EXPIRY_ALERT_DISMISS_KEY) === getExpiryAlertDismissId()

const saveExpiryAlertDismiss = () => {
  localStorage.setItem(EXPIRY_ALERT_DISMISS_KEY, getExpiryAlertDismissId())
}

const shouldPromptExpiryAlert = () => {
  if (remainingDays.value === null) return false
  return remainingDays.value <= 3
}

const maybeShowExpiryAlert = () => {
  if (!shouldPromptExpiryAlert()) return
  if (isExpiryAlertDismissed()) return
  expiryAlertDontShow.value = false
  showExpiryAlertDialog.value = true
}

const closeExpiryAlertDialog = () => {
  showExpiryAlertDialog.value = false
}

const onExpiryAlertClosed = () => {
  if (expiryAlertDontShow.value) saveExpiryAlertDismiss()
}

const openRenewFromExpiryAlert = () => {
  showExpiryAlertDialog.value = false
  showContactDialog.value = true
}

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
const showContactDialog = ref(false)
const showRenameDialog = ref(false)
const renamingFile = ref(null)
const renaming = ref(false)
const uploadQueue = ref([])
const uploading = ref(false)
const autoStartUpload = ref(localStorage.getItem('upload_auto_start') !== 'false')
const isDragover = ref(false)
const isFileDragOver = ref(false)
const isPageDragOver = ref(false)
let uploadAreaDragDepth = 0
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

const siteUrl = computed(() => domain.value ? `https://${domain.value}` : '')

const uploadQueueStats = computed(() => {
  const q = uploadQueue.value
  return {
    total: q.length,
    pending: q.filter(f => f.status === 'pending').length,
    uploading: q.filter(f => f.status === 'uploading').length,
    done: q.filter(f => f.status === 'done').length,
    error: q.filter(f => f.status === 'error').length,
    totalBytes: q.reduce((s, f) => s + f.file.size, 0),
  }
})

const overallUploadProgress = computed(() => {
  const total = uploadQueueStats.value.totalBytes
  if (!total) return 0
  const done = uploadQueue.value.filter(f => f.status === 'done').reduce((s, f) => s + f.file.size, 0)
  const uploadingBytes = uploadQueue.value
    .filter(f => f.status === 'uploading')
    .reduce((s, f) => s + f.file.size * (f.progress || 0) / 100, 0)
  return Math.min(100, Math.round((done + uploadingBytes) / total * 100))
})

const showUploadFloat = computed(() =>
  !showUploadDialog.value && (
    uploading.value ||
    uploadQueue.value.some(f => f.status === 'uploading' || f.status === 'pending')
  )
)

const storagePercent = computed(() => {
  if (!maxUploadSize.value) return 0
  return Math.min(100, Math.round((usedSize.value / maxUploadSize.value) * 100))
})

const storageStatus = computed(() => {
  const p = storagePercent.value
  if (p >= 95) return 'exception'
  if (p >= 80) return 'warning'
  return ''
})

const fileCount = computed(() => totalFileCount.value)
const folderCount = computed(() => totalFolderCount.value)

const expiryLabel = computed(() => {
  if (remainingDays.value === null) return '永久'
  if (remainingDays.value <= 0) return '已过期'
  return `${remainingDays.value} 天`
})

const expiryHint = computed(() => {
  if (remainingDays.value === null) return ''
  if (remainingDays.value <= 0) return '请联系续费'
  if (remainingDays.value <= 7) return '即将到期'
  return ''
})

watch(autoStartUpload, (val) => {
  localStorage.setItem('upload_auto_start', val ? 'true' : 'false')
})

const api = async (url, data = {}) => {
  const res = await fetch(`${API_BASE}/api/upload${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: authCode.value, ...data })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || '请求失败')
    err.code = json.code
    err.status = res.status
    err.data = json
    throw err
  }
  return json
}

const resetAuthBlocked = () => {
  authBlocked.value = null
  blockedDomain.value = ''
  authCode.value = ''
  localStorage.removeItem('upload_auth_code')
}

const verifyAuth = async () => {
  if (!authCode.value) { ElMessage.warning('请输入授权码'); return }
  authBlocked.value = null
  blockedDomain.value = ''
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
    await loadFiles()
    await loadDirectUploadConfig()
    maybeShowExpiryAlert()
  } catch (e) {
    if (e.code === 'disabled' || e.status === 403) {
      authBlocked.value = 'disabled'
      blockedDomain.value = e.data?.domain || ''
      authorized.value = false
      localStorage.removeItem('upload_auth_code')
    } else {
      ElMessage.error(e.message || '验证失败')
    }
  } finally {
    verifying.value = false
  }
}

// 获取并探测 PHP 直传配置（缺失脚本时后台自动下发）
const loadDirectUploadConfig = async () => {
  directUploadOk.value = false
  directConfig.value = null
  try {
    console.log('[直传] 请求直传配置...')
    const cfg = await api('/direct-config')
    if (cfg.script_status === 'exists') {
      console.log('[直传] 脚本已存在，跳过创建:', cfg.script_message)
    } else if (cfg.script_status === 'deployed') {
      console.log('[直传] 脚本不存在，已自动创建:', cfg.script_message)
    } else if (cfg.script_status === 'migrated') {
      console.log('[直传] 已从旧版迁移:', cfg.script_message)
    } else if (cfg.script_status === 'exists_legacy') {
      console.warn('[直传] 使用旧版路径:', cfg.script_message)
    } else if (cfg.script_status === 'failed') {
      console.warn('[直传] 自动创建脚本失败:', cfg.script_message)
    } else if (cfg.script_status === 'no_server') {
      console.warn('[直传] 未绑定服务器，无法自动创建脚本')
    }

    if (cfg.php_fix) {
      if (cfg.php_fix.success) {
        console.log('[直传] PHP 配置:', cfg.php_fix.message)
      } else {
        console.warn('[直传] PHP 配置补齐失败:', cfg.php_fix.message)
      }
    }

    console.log('[直传] 探测直传端点:', cfg.domain, cfg.upload_url)
    const uploadPath = await PhpDirectUploader.probe(cfg.domain, 4000, cfg.upload_url)
    if (uploadPath) {
      directConfig.value = { ...cfg, upload_url: uploadPath }
      directUploadOk.value = true
      console.log('[直传] PHP 直传可用，路径:', uploadPath)
    } else {
      console.log('[直传] 端点未响应，回退中转上传')
    }
  } catch (e) {
    console.log('[直传] 获取直传配置失败，回退中转上传:', e.message)
  }
}

const logout = () => { authorized.value = false; authCode.value = ''; localStorage.removeItem('upload_auth_code') }
const openWebsite = () => window.open(siteUrl.value, '_blank')
const openFileUrl = (file) => {
  window.open(`${siteUrl.value}/${fileRelPath(file)}`, '_blank')
}
const copyWechat = () => {
  navigator.clipboard.writeText('feiyu3305')
  ElMessage.success('微信号已复制')
}

const copyDomain = async () => {
  if (!siteUrl.value) return
  try {
    await navigator.clipboard.writeText(siteUrl.value)
    ElMessage.success(`已复制：${siteUrl.value}`)
  } catch {
    ElMessage.error('复制失败，请手动选择复制')
  }
}

const loadFiles = async (skipUsage = false) => {
  loading.value = true
  try {
    const promises = [api('/list', {
      path: currentPath.value,
      page: currentPage.value,
      pageSize: pageSize.value,
      keyword: searchKeyword.value.trim(),
      search_subdirs: searchSubdirs.value
    })]

    if (!skipUsage) {
      promises.push(api('/usage'))
    }

    const results = await Promise.all(promises)
    const listResult = results[0]

    totalFiles.value = listResult.total ?? listResult.files.length
    totalFileCount.value = listResult.file_count ?? listResult.files.filter(f => f.type === 'file').length
    totalFolderCount.value = listResult.folder_count ?? listResult.files.filter(f => f.type === 'directory').length

    const maxPage = Math.max(1, Math.ceil(totalFiles.value / pageSize.value))
    if (currentPage.value > maxPage) {
      currentPage.value = maxPage
      loading.value = false
      return loadFiles(skipUsage)
    }

    files.value = listResult.files
    searchTruncated.value = !!listResult.search_truncated

    if (results[1]) {
      usedSize.value = results[1].used_size || 0
    }
  } catch (err) {
    ElMessage.error('加载失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

const onPageChange = (page) => {
  currentPage.value = page
  selectedFiles.value = []
  loadFiles(true)
}

const onPageSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  selectedFiles.value = []
  loadFiles(true)
}

const resetSearch = () => {
  skipSearchWatch = true
  searchKeyword.value = ''
  skipSearchWatch = false
}

const clearSearch = () => {
  resetSearch()
  searchTruncated.value = false
  currentPage.value = 1
  selectedFiles.value = []
  loadFiles(true)
}

watch(searchKeyword, () => {
  if (skipSearchWatch) return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    selectedFiles.value = []
    loadFiles(true)
  }, 300)
})

watch(searchSubdirs, (val) => {
  localStorage.setItem('upload_search_subdirs', val ? 'true' : 'false')
  if (!searchKeyword.value.trim()) return
  currentPage.value = 1
  selectedFiles.value = []
  loadFiles(true)
})

const navigateTo = (path) => { currentPath.value = path; currentPage.value = 1; selectedFiles.value = []; resetSearch(); loadFiles(true) }
const goBack = () => { const parts = currentPath.value.split('/').filter(p => p); parts.pop(); currentPath.value = parts.join('/'); currentPage.value = 1; selectedFiles.value = []; resetSearch(); loadFiles(true) }

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
  maybeAutoStartUpload()
}

// 处理文件冲突
const handleFileConflict = async (allFiles, existingFiles, { autoStart = true } = {}) => {
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
      if (autoStart) maybeAutoStartUpload()
    } catch (e) {
      // 用户选择跳过，只添加不存在的文件
      const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
      uploadQueue.value.push(...filesToAdd)
      if (filesToAdd.length > 0) {
        ElMessage.info(`已跳过 1 个文件，添加了 ${filesToAdd.length} 个文件`)
        if (autoStart) maybeAutoStartUpload()
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
      if (autoStart) maybeAutoStartUpload()
    } catch (action) {
      if (action === 'cancel') {
        const filesToAdd = allFiles.filter(f => !existingFiles.includes(f))
        uploadQueue.value.push(...filesToAdd)
        if (filesToAdd.length > 0) {
          ElMessage.info(`已跳过 ${existingFiles.length} 个文件，添加了 ${filesToAdd.length} 个文件`)
          if (autoStart) maybeAutoStartUpload()
        } else {
          ElMessage.info(`已跳过所有文件`)
        }
      } else {
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

const hasFileDrag = (e) => {
  const types = e.dataTransfer?.types
  return types ? [...types].includes('Files') : false
}

const collectFilesFromDrop = async (e) => {
  const items = e.dataTransfer?.items
  if (!items) return []
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
              for (const ent of entries) { await readEntry(ent, path ? path + '/' + entry.name : entry.name) }
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
    if (entry) { promises.push(readEntry(entry)) }
    else if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) filesList.push({ file, name: file.name, relativePath: '', uploadPath: file.name, status: 'pending' })
    }
  }
  await Promise.all(promises)
  return filesList
}

const enqueueDroppedFiles = async (filesList, { showMessage = false, autoStart = true } = {}) => {
  if (filesList.length === 0) return

  const existingFiles = []
  for (const item of filesList) {
    const filePath = item.relativePath || item.name
    const pathParts = filePath.split('/')
    const fileName = pathParts[pathParts.length - 1]
    if (!item.relativePath || pathParts.length === 1) {
      const exists = files.value.some(f => f.type === 'file' && f.name === fileName)
      if (exists) existingFiles.push(item)
    }
  }

  if (existingFiles.length > 0) {
    await handleFileConflict(filesList, existingFiles, { autoStart })
  } else {
    uploadQueue.value.push(...filesList)
  }

  if (showMessage) {
    ElMessage.success(autoStart
      ? `已添加 ${filesList.length} 个文件到上传队列`
      : `已添加 ${filesList.length} 个文件，请确认后点击「开始上传」`)
  }
  if (autoStart) maybeAutoStartUpload()
}

const handleDrop = async (e) => {
  e.preventDefault()
  e.stopPropagation()
  isDragover.value = false
  uploadAreaDragDepth = 0
  const filesList = await collectFilesFromDrop(e)
  await enqueueDroppedFiles(filesList, { autoStart: false })
}

const handleUploadAreaDragEnter = (e) => {
  if (!hasFileDrag(e)) return
  e.preventDefault()
  uploadAreaDragDepth++
  isDragover.value = true
}

const handleUploadAreaDragOver = (e) => {
  if (!hasFileDrag(e)) return
  e.preventDefault()
}

const handleUploadAreaDragLeave = (e) => {
  if (!hasFileDrag(e)) return
  uploadAreaDragDepth--
  if (uploadAreaDragDepth <= 0) {
    uploadAreaDragDepth = 0
    isDragover.value = false
  }
}

const resetPageDragState = () => {
  isPageDragOver.value = false
}

const isLeavingViewport = (e) => {
  const { clientX, clientY } = e
  return clientX <= 0 || clientY <= 0 || clientX >= window.innerWidth || clientY >= window.innerHeight
}

// 文件列表区域拖拽处理
const handleFileDragOver = (e) => {
  e.preventDefault()
  isFileDragOver.value = true
}

const handleFileDragLeave = (e) => {
  if (e.target.classList.contains('file-list')) {
    isFileDragOver.value = false
  }
}

const handleFileListDrop = async (e) => {
  e.preventDefault()
  e.stopPropagation()
  isFileDragOver.value = false
  resetPageDragState()
  showUploadDialog.value = true
  const filesList = await collectFilesFromDrop(e)
  await enqueueDroppedFiles(filesList, { showMessage: true, autoStart: false })
}

const handlePageDragOver = (e) => {
  if (!authorized.value || showUploadDialog.value || !hasFileDrag(e)) return
  e.preventDefault()
  isPageDragOver.value = true
}

const handlePageDragLeave = (e) => {
  if (!hasFileDrag(e)) return
  if (e.relatedTarget === null || isLeavingViewport(e)) resetPageDragState()
}

const handlePageDragEnd = () => {
  resetPageDragState()
}

const handlePageDrop = async (e) => {
  if (!authorized.value || showUploadDialog.value || !hasFileDrag(e)) return
  if (e.target.closest?.('.file-list') || e.target.closest?.('.upload-area') || e.target.closest?.('.upload-add-strip')) return
  e.preventDefault()
  e.stopPropagation()
  resetPageDragState()
  showUploadDialog.value = true
  const filesList = await collectFilesFromDrop(e)
  await enqueueDroppedFiles(filesList, { showMessage: true, autoStart: false })
}

const bindPageDragEvents = () => {
  unbindPageDragEvents()
  window.addEventListener('dragover', handlePageDragOver)
  window.addEventListener('dragleave', handlePageDragLeave)
  window.addEventListener('drop', handlePageDrop)
  window.addEventListener('dragend', handlePageDragEnd)
}

const unbindPageDragEvents = () => {
  window.removeEventListener('dragover', handlePageDragOver)
  window.removeEventListener('dragleave', handlePageDragLeave)
  window.removeEventListener('drop', handlePageDrop)
  window.removeEventListener('dragend', handlePageDragEnd)
}

const updatePageDragEvents = () => {
  if (authorized.value && !showUploadDialog.value) {
    bindPageDragEvents()
  } else {
    unbindPageDragEvents()
    resetPageDragState()
  }
}

const maybeAutoStartUpload = () => {
  if (!autoStartUpload.value || uploading.value) return
  if (!uploadQueue.value.some(f => f.status === 'pending')) return
  setTimeout(() => {
    if (!uploading.value && uploadQueue.value.some(f => f.status === 'pending')) {
      startUpload()
    }
  }, 400)
}

const handleUploadDialogClose = (done) => {
  if (uploading.value) {
    done()
    return
  }
  if (uploadQueue.value.length === 0) {
    done()
    return
  }
  ElMessageBox.confirm('关闭将清空当前上传列表，确定吗？', '提示', {
    type: 'warning',
    confirmButtonText: '清空并关闭',
    cancelButtonText: '继续编辑',
  }).then(() => {
    uploadQueue.value = []
    done()
  }).catch(() => {})
}

const clearCompletedUploads = () => {
  uploadQueue.value = uploadQueue.value.filter(f => f.status !== 'done')
}

const retryAllFailed = async () => {
  const failed = uploadQueue.value.filter(f => f.status === 'error')
  if (failed.length === 0) return
  failed.forEach(f => {
    f.status = 'pending'
    f.progress = 0
    f.errorMessage = ''
  })
  await startUpload()
}

const handlePaste = (e) => {
  if (!authorized.value || showEditDialog.value) return
  const items = e.clipboardData?.items
  if (!items) return
  const pastedFiles = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) pastedFiles.push(file)
    }
  }
  if (pastedFiles.length === 0) return
  e.preventDefault()
  showUploadDialog.value = true
  checkAndAddFiles(pastedFiles, false)
  ElMessage.info(`已从剪贴板添加 ${pastedFiles.length} 个文件`)
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

// 统一计算上传速度和剩余时间（基于总耗时平均速度，适配并发分片）
const updateItemSpeed = (item, loadedBytes, totalBytes) => {
  const now = Date.now()
  if (item._uploadStartTime == null) item._uploadStartTime = now

  const elapsedSec = (now - item._uploadStartTime) / 1000
  if (elapsedSec >= 0.5 && loadedBytes > 0) {
    const avgSpeed = loadedBytes / elapsedSec
    item.speedRaw = item.speedRaw != null ? item.speedRaw * 0.85 + avgSpeed * 0.15 : avgSpeed
    item.speed = formatSize(item.speedRaw) + '/s'
    const remainBytes = Math.max(0, totalBytes - loadedBytes)
    item.eta = item.speedRaw > 0 ? formatDuration((remainBytes / item.speedRaw) * 1000) : ''
  }
  item._lastTime = now
  item._lastBytes = loadedBytes
}

// 上传单个文件（提取出来以支持并发）
const uploadSingleFile = async (item) => {
  if (item.status !== 'pending') return
  
  item.status = 'uploading'
  item.progress = 0
  // 重置进度/速度/步骤相关字段
  item.step = 1
  item.totalSteps = 2
  item.stepLabel = '准备中'
  item.speed = ''
  item.eta = ''
  item.serverPhase = ''
  item.speedRaw = null
  item._lastTime = null
  item._lastBytes = 0
  item._uploadStartTime = null
  
  try {
    let uploadDir = currentPath.value
    const filePath = item.uploadPath || item.name
    const pathParts = filePath.split('/')
    const fileName = pathParts.pop()
    if (pathParts.length > 0) uploadDir = currentPath.value ? currentPath.value + '/' + pathParts.join('/') : pathParts.join('/')
    
    // 三种上传方式封装
    // 中转分片上传（浏览器→后端→目标服务器）
    const runChunked = async () => {
      item.totalSteps = 2
      item._uploadStartTime = Date.now()
      const uploader = new ChunkedUploader(item.file, {
        authCode: authCode.value,
        path: uploadDir,
        onProgress: (progress) => {
          if (progress.serverPhase) {
            item.step = 2
            item.stepLabel = progress.serverPhase
            item.progress = progress.serverProgress || 0
            item.speed = ''
            item.eta = ''
          } else {
            item.step = 1
            item.stepLabel = '上传文件'
            item.progress = progress.percentage
            updateItemSpeed(item, progress.loadedBytes, progress.totalBytes)
          }
        },
        onSuccess: () => { item.progress = 100 },
        onError: (err) => { console.error('分片上传失败:', err) }
      })
      item.uploader = uploader
      await uploader.start()
    }

    // 统一使用分片上传（不区分大小）：优先 PHP 直传，失败自动回退中转分片
    if (directUploadOk.value) {
      try {
        item.totalSteps = 1
        item._uploadStartTime = Date.now()
        const uploader = new PhpDirectUploader(item.file, {
          domain: directConfig.value.domain,
          token: directConfig.value.token,
          expires: directConfig.value.expires,
          uploadPath: directConfig.value.upload_url,
          path: uploadDir,
          onProgress: (progress) => {
            item.step = 1
            item.stepLabel = '直传到服务器'
            item.progress = progress.percentage
            updateItemSpeed(item, progress.loadedBytes, progress.totalBytes)
          },
          onError: (err) => { console.error('直传失败:', err) }
        })
        item.uploader = uploader
        await uploader.start()
      } catch (err) {
        console.warn('直传失败，自动回退中转上传:', err.message)
        // 重置进度后回退
        item.progress = 0
        item.speed = ''
        item.eta = ''
        item.speedRaw = null
        item._lastTime = null
        item._lastBytes = 0
        item._uploadStartTime = null
        await runChunked()
      }
    } else {
      await runChunked()
    }

    item.status = 'done'
    item.progress = 100
    usedSize.value += item.file.size
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
  await api('/delete', { path: fileRelPath(file) })
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
  const oldPath = fileRelPath(renamingFile.value)
  const newPath = oldPath.includes('/')
    ? `${oldPath.slice(0, oldPath.lastIndexOf('/') + 1)}${newFileName.value}`
    : newFileName.value
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
    const res = await api('/read', { path: fileRelPath(file) })
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
    await api('/write', { path: fileRelPath(editingFile.value), content: fileContent.value })
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
  const filePath = fileRelPath(file)
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
      await api('/extract', { path: fileRelPath(file) })
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
      const filePath = fileRelPath(file)
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
      path: fileRelPath(file)
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
      path: fileRelPath(file)
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
  document.body.classList.add('upload-theme-page')
  document.title = '文件空间'
  // 检查 URL 参数中的授权码
  const urlParams = new URLSearchParams(window.location.search)
  const codeFromUrl = urlParams.get('code')
  if (codeFromUrl) {
    authCode.value = codeFromUrl
    window.history.replaceState({}, '', window.location.pathname)
  }

  if (authCode.value) verifyAuth()

  window.addEventListener('resize', handleResize)
  window.addEventListener('paste', handlePaste)
  document.addEventListener('mousedown', onContextMenuDismiss)
  document.addEventListener('scroll', hideContextMenu, true)
  document.addEventListener('keydown', onContextMenuKeydown)
})

watch([authorized, showUploadDialog], updatePageDragEvents, { immediate: true })

onUnmounted(() => {
  document.body.classList.remove('upload-theme-page')
  document.title = '虚拟主机管理系统'
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('paste', handlePaste)
  document.removeEventListener('mousedown', onContextMenuDismiss)
  document.removeEventListener('scroll', hideContextMenu, true)
  document.removeEventListener('keydown', onContextMenuKeydown)
  unbindPageDragEvents()
  if (uploadStatsInterval.value) clearInterval(uploadStatsInterval.value)
  if (searchTimer) clearTimeout(searchTimer)
})

const handleResize = () => {
  windowWidth.value = window.innerWidth
}
</script>

<style scoped>
/* Layout-only — Canvas Loft visuals in upload-theme-v3.css */

.page-drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
}

.page-drag-tip {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 24px;
  font-size: 14px;
  white-space: nowrap;
}

.file-list {
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  transition: background 0.2s, border-color 0.2s;
}

.file-list.drag-over.empty-list::before {
  content: '📤 拖放文件到这里上传';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 16px;
  font-weight: 600;
  pointer-events: none;
  z-index: 10;
  padding: 16px 32px;
  border-radius: var(--loft-radius, 12px);
}

.file-list.drag-over:not(.empty-list)::after {
  content: '📤 松开鼠标上传文件';
  position: fixed;
  bottom: 20px;
  right: 20px;
  font-size: 13px;
  padding: 10px 20px;
  border-radius: 999px;
  z-index: 1000;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  border-bottom: 1px solid var(--loft-border, rgba(42, 38, 34, 0.08));
}

.file-checkbox {
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-checkbox :deep(.el-checkbox) {
  height: 16px;
}

.file-checkbox :deep(.el-checkbox__inner) {
  width: 14px;
  height: 14px;
}

.file-icon {
  width: 28px;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  font-size: 13px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 11px;
  margin-top: 2px;
  line-height: 1.2;
}

.file-type-label {
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.file-size-col {
  width: 80px;
  text-align: right;
  font-size: 12px;
  flex-shrink: 0;
  padding-right: 8px;
  font-variant-numeric: tabular-nums;
}

.file-date-col {
  width: 130px;
  text-align: right;
  font-size: 11px;
  flex-shrink: 0;
  padding-right: 8px;
  font-variant-numeric: tabular-nums;
}

.file-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 88px;
  justify-content: flex-end;
}

.file-actions :deep(.el-dropdown) {
  line-height: 1;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
  padding: 12px;
  justify-content: center;
}

.grid-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 10px;
  border-radius: var(--loft-radius, 12px);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  min-height: 100px;
  justify-content: center;
}

.grid-checkbox {
  position: absolute;
  top: 6px;
  left: 6px;
}

.grid-icon {
  font-size: 32px;
  margin-bottom: 6px;
}

.grid-name {
  font-size: 12px;
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
  font-weight: 500;
}

.grid-size {
  font-size: 10px;
  text-align: center;
  margin-top: 4px;
}

.grid-more {
  position: absolute;
  top: 6px;
  right: 6px;
}

.upload-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 6px;
}

.upload-dialog-title {
  font-size: 15px;
  font-weight: 600;
}

.upload-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upload-overall-progress {
  padding: 6px 0 0;
}

.upload-overall-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
}

.upload-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.upload-queue-actions {
  display: flex;
  gap: 2px;
}

.upload-queue-list {
  max-height: 240px;
  overflow-y: auto;
  border-radius: var(--loft-radius, 12px);
}

.upload-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
}

.upload-queue-item:last-child {
  border-bottom: none;
}

.upload-item-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.upload-item-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.upload-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-item-path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-item-error {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-item-progress {
  margin-top: 4px;
}

.upload-item-step {
  font-size: 10px;
}

.upload-item-size {
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.upload-item-tag {
  flex-shrink: 0;
}

.upload-stats-bar {
  display: flex;
  gap: 16px;
  padding: 6px 10px;
  border-radius: var(--loft-radius, 12px);
  font-size: 11px;
}

.upload-dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  flex-wrap: wrap;
  gap: 8px;
}

.upload-dialog-footer-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.upload-float-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  left: 24px;
  max-width: 420px;
  margin-left: auto;
  z-index: 2000;
  cursor: pointer;
}

.upload-float-content {
  display: flex;
  align-items: center;
  padding: 14px 16px;
}

.upload-float-info {
  display: flex;
  flex-direction: column;
  min-width: 72px;
}

.upload-float-title {
  font-size: 14px;
  font-weight: 600;
}

.upload-float-detail {
  font-size: 12px;
  margin-top: 2px;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.upload-area {
  border: 2px dashed var(--loft-border-strong, rgba(42, 38, 34, 0.14));
  border-radius: var(--loft-radius-lg, 18px);
  padding: 28px 16px;
  text-align: center;
  transition: border-color 0.2s, background 0.2s;
}

.upload-area-icon {
  font-size: 36px;
  margin-bottom: 10px;
}

.upload-text {
  font-size: 14px;
  margin-bottom: 12px;
}

.upload-hint {
  font-size: 12px;
  margin-top: 10px;
}

.upload-add-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px dashed var(--loft-border-strong, rgba(42, 38, 34, 0.14));
  border-radius: var(--loft-radius, 12px);
  font-size: 12px;
  transition: all 0.2s;
}

.upload-add-strip-or {
  margin-left: auto;
  font-size: 11px;
}

.empty-tip {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.empty-icon {
  font-size: 52px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-hint {
  font-size: 13px;
  margin-bottom: 8px;
}

.quick-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  justify-content: center;
}

.editor-container {
  border-radius: var(--loft-radius, 12px);
  overflow: hidden;
  min-height: 400px;
}

.editor-container :deep(.cm-editor) {
  font-size: 14px;
}

.editor-container :deep(.cm-scroller) {
  font-family: 'IBM Plex Mono', 'Fira Code', 'Monaco', 'Menlo', monospace;
}

.contact-dialog-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-left: 6px;
}

.contact-dialog-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

.contact-dialog-title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.contact-dialog-subtitle {
  font-size: 12px;
  margin-top: 2px;
}

.contact-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.contact-card {
  border-radius: var(--loft-radius-lg, 18px);
  padding: 24px 20px;
}

.contact-qrcode-section {
  text-align: center;
}

.qrcode-frame {
  display: inline-block;
  padding: 10px;
  background: #fff;
  border-radius: var(--loft-radius-lg, 18px);
}

.qrcode-img {
  width: 160px;
  height: 160px;
  border-radius: 8px;
  display: block;
}

.qrcode-tip {
  font-size: 13px;
  margin-top: 12px;
  font-weight: 500;
}

.contact-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 16px;
  font-size: 12px;
}

.contact-divider::before,
.contact-divider::after {
  content: '';
  flex: 1;
  height: 1px;
}

.contact-wechat-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wechat-id-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--loft-radius, 12px);
}

.wechat-id-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wechat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.wechat-id {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.03em;
  font-family: var(--loft-font-mono, monospace);
}

.wechat-copy-btn {
  flex-shrink: 0;
}

.contact-desc {
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  padding: 0 4px;
}

.contact-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: var(--loft-radius, 12px);
  font-size: 12px;
}

.contact-footer-icon {
  font-size: 14px;
}

.help-compact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.help-rule-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-radius: var(--loft-radius, 12px);
  font-size: 12px;
}

.help-rule-key {
  font-weight: 600;
}

.help-rule-domain {
  font-size: 12px;
  opacity: 0.95;
}

.help-rule-domain code {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.help-steps-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 0;
}

.help-step-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.help-step-pill span {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.help-step-arrow {
  font-size: 11px;
}

.help-main-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.help-tree-card {
  border-radius: var(--loft-radius, 12px);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.help-tree-badge {
  font-size: 12px;
  font-weight: 600;
}

.help-tree {
  font-family: var(--loft-font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  border-radius: 6px;
  padding: 6px 8px;
}

.help-tree-line {
  display: block;
}

.help-tree-root {
  font-weight: 600;
}

.help-tree-foot {
  font-size: 11px;
  line-height: 1.4;
}

.help-tree-foot code {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
}

.help-bottom-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.help-path-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: var(--loft-radius, 12px);
  font-size: 11px;
  overflow: hidden;
}

.help-path-mini-label {
  font-weight: 600;
  flex-shrink: 0;
  font-size: 11px;
}

.help-path-mini code {
  font-family: var(--loft-font-mono, monospace);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
}

.help-footnote {
  font-size: 11px;
  text-align: center;
  line-height: 1.4;
}

.help-footnote code {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
}

.upload-help-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s;
}

.upload-help-link code {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 11px;
}

@media (max-width: 768px) {
  .page-drag-tip {
    font-size: 13px;
    padding: 6px 16px;
    top: 12px;
    max-width: 90vw;
    white-space: normal;
    text-align: center;
  }

  .file-item {
    padding: 5px 8px;
  }

  .file-icon {
    width: 24px;
    font-size: 14px;
  }

  .file-name {
    font-size: 12px;
  }

  .file-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .contact-card {
    padding: 20px 16px;
  }

  .qrcode-img {
    width: 140px;
    height: 140px;
  }

  .wechat-id-row {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .wechat-copy-btn {
    width: 100%;
  }

  .help-main-grid {
    grid-template-columns: 1fr;
  }

  .help-bottom-row {
    grid-template-columns: 1fr;
  }

  .help-rule-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .upload-area {
    padding: 20px 12px;
  }

  .upload-queue-list {
    max-height: 200px;
  }

  .upload-dialog-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .upload-dialog-footer-btns {
    justify-content: flex-end;
  }

  .upload-float-panel {
    left: 12px;
    right: 12px;
    bottom: 12px;
  }

  .empty-tip {
    padding: 32px 16px;
  }

  .empty-icon {
    font-size: 40px;
  }

  .quick-actions {
    flex-direction: column;
    width: 100%;
    max-width: 240px;
  }
}
</style>
