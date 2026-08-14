import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOutlined,
  HomeOutlined,
  ReloadOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { Breadcrumb, Button, Input, Modal, Space, Spin, Upload, message } from 'antd'
import api from '@/api'
import { confirmAction } from '@/utils'
import './FileManager.css'

const EDITABLE_EXTS = ['txt', 'html', 'htm', 'css', 'js', 'json', 'xml', 'md', 'php', 'py', 'sh', 'sql', 'conf', 'ini', 'log', 'yml', 'yaml', 'env', 'htaccess']

const FILE_ICONS = {
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
  mp4: '🎬', avi: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵',
  pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙',
  zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  html: '🌐', htm: '🌐', css: '🎨', js: '📜', ts: '📜', json: '📋',
  php: '🐘', py: '🐍', rb: '💎', go: '🔵', java: '☕',
  txt: '📄', md: '📝', sql: '🗃️', sh: '⚙️', bash: '⚙️',
  conf: '⚙️', ini: '⚙️', yml: '⚙️', yaml: '⚙️', env: '🔐', log: '📋', xml: '📰'
}

function isEditable(name) {
  return EDITABLE_EXTS.includes(name.split('.').pop().toLowerCase())
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  return FILE_ICONS[ext] || '📄'
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function joinPath(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function FileManager({ open, server, onClose }) {
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState('/')
  const [selectedFile, setSelectedFile] = useState(null)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null })

  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingFile, setEditingFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [savingFile, setSavingFile] = useState(false)

  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renamingFile, setRenamingFile] = useState(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const pathParts = useMemo(() => currentPath.split('/').filter(Boolean), [currentPath])

  useEffect(() => {
    if (!open || !server) {
      setContextMenu((menu) => (menu.visible ? { visible: false, x: 0, y: 0, file: null } : menu))
      return undefined
    }
    const initialPath = '/www/wwwroot/ftp'
    const serverId = server.id
    setCurrentPath(initialPath)
    setSelectedFile(null)
    setContextMenu({ visible: false, x: 0, y: 0, file: null })
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await api.post(`/servers/${serverId}/files`, { path: initialPath })
        if (cancelled) return
        setFiles((res.files || []).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        }))
      } catch {
        if (!cancelled) setFiles([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, server])

  useEffect(() => {
    if (!contextMenu.visible) return undefined
    function hide() {
      setContextMenu((menu) => ({ ...menu, visible: false }))
    }
    const timer = window.setTimeout(() => {
      document.addEventListener('click', hide)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', hide)
    }
  }, [contextMenu.visible])

  async function loadFilesAt(path) {
    if (!server) return
    setLoading(true)
    setSelectedFile(null)
    try {
      const res = await api.post(`/servers/${server.id}/files`, { path })
      setFiles((res.files || []).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      }))
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }

  function loadFiles() {
    return loadFilesAt(currentPath)
  }

  function goBack() {
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const next = `/${parts.join('/')}`
    setCurrentPath(next)
    loadFilesAt(next)
  }

  function goToPath(path) {
    const next = path || '/'
    setCurrentPath(next)
    loadFilesAt(next)
  }

  function handleDblClick(file) {
    if (file.type === 'directory') {
      const next = joinPath(currentPath, file.name)
      setCurrentPath(next)
      loadFilesAt(next)
    } else if (isEditable(file.name)) {
      editFile(file)
    }
  }

  function showContextMenu(event, file) {
    event.preventDefault()
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, file })
  }

  async function createFolder() {
    if (!newFolderName) return
    setCreating(true)
    try {
      await api.post(`/servers/${server.id}/files/mkdir`, { path: currentPath, name: newFolderName })
      message.success('创建成功')
      setShowNewFolderDialog(false)
      setNewFolderName('')
      loadFiles()
    } finally {
      setCreating(false)
    }
  }

  async function startUpload() {
    setUploading(true)
    let success = 0
    let failed = 0
    for (const item of uploadFiles) {
      try {
        const raw = item.originFileObj
        if (!raw) {
          failed += 1
          continue
        }
        const content = await fileToBase64(raw)
        await api.post(`/servers/${server.id}/files/upload`, {
          path: currentPath,
          filename: item.name,
          content
        })
        success += 1
      } catch {
        failed += 1
      }
    }
    setUploading(false)
    message.success(`上传完成: 成功${success}个${failed ? `, 失败${failed}个` : ''}`)
    setShowUploadDialog(false)
    setUploadFiles([])
    loadFiles()
  }

  async function editFile(file) {
    setEditingFile(file)
    setFileContent('')
    setShowEditDialog(true)
    setLoadingContent(true)
    try {
      const filePath = joinPath(currentPath, file.name)
      const res = await api.post(`/servers/${server.id}/files/read`, { path: filePath })
      setFileContent(res.content || '')
    } catch {
      setShowEditDialog(false)
    } finally {
      setLoadingContent(false)
    }
  }

  async function saveFile() {
    setSavingFile(true)
    try {
      const filePath = joinPath(currentPath, editingFile.name)
      await api.post(`/servers/${server.id}/files/write`, { path: filePath, content: fileContent })
      message.success('保存成功')
      setShowEditDialog(false)
    } finally {
      setSavingFile(false)
    }
  }

  async function downloadFile(file) {
    try {
      const filePath = joinPath(currentPath, file.name)
      const res = await api.post(`/servers/${server.id}/files/read-binary`, { path: filePath })
      const blob = new Blob([Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0))])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // 拦截器已提示
    }
  }

  function renameItem(file) {
    setRenamingFile(file)
    setNewName(file.name)
    setShowRenameDialog(true)
  }

  async function doRename() {
    if (!newName || newName === renamingFile.name) {
      setShowRenameDialog(false)
      return
    }
    setRenaming(true)
    try {
      const oldPath = joinPath(currentPath, renamingFile.name)
      const newPath = joinPath(currentPath, newName)
      await api.post(`/servers/${server.id}/files/rename`, { oldPath, newPath })
      message.success('重命名成功')
      setShowRenameDialog(false)
      loadFiles()
    } finally {
      setRenaming(false)
    }
  }

  async function deleteItem(file) {
    try {
      await confirmAction(
        `确定删除 "${file.name}"？${file.type === 'directory' ? '\n文件夹内所有内容将被删除！' : ''}`,
        '确认删除'
      )
    } catch {
      return
    }
    try {
      const filePath = joinPath(currentPath, file.name)
      await api.post(`/servers/${server.id}/files/delete`, { path: filePath })
      message.success('删除成功')
      loadFiles()
    } catch {
      // 拦截器已提示
    }
  }

  function handleClose() {
    setContextMenu({ visible: false, x: 0, y: 0, file: null })
    onClose?.()
  }

  return (
    <>
      <Modal
        title={`📁 ${server?.name} - 文件管理`}
        open={open}
        onCancel={handleClose}
        footer={null}
        width={1000}
        style={{ top: '3vh' }}
        maskClosable={false}
        destroyOnClose
      >
        <div className="file-manager">
          <div className="file-manager-toolbar">
            <div className="file-manager-nav">
              <Space.Compact>
                <Button icon={<ArrowLeftOutlined />} disabled={currentPath === '/'} onClick={goBack} />
                <Button icon={<HomeOutlined />} onClick={() => goToPath('/')} />
                <Button icon={<ReloadOutlined />} onClick={loadFiles} />
              </Space.Compact>
            </div>
            <div className="file-manager-path">
              <Breadcrumb
                separator="/"
                items={[
                  {
                    title: <HomeOutlined />,
                    className: 'path-item',
                    onClick: () => goToPath('/')
                  },
                  ...pathParts.map((part, index) => ({
                    title: part,
                    className: 'path-item',
                    onClick: () => goToPath(`/${pathParts.slice(0, index + 1).join('/')}`)
                  }))
                ]}
              />
            </div>
            <div className="file-manager-actions">
              <Button type="primary" icon={<FolderAddOutlined />} onClick={() => setShowNewFolderDialog(true)}>新建</Button>
              <Button color="green" variant="solid" icon={<UploadOutlined />} onClick={() => setShowUploadDialog(true)}>上传</Button>
            </div>
          </div>

          <Spin spinning={loading}>
            <div className="file-grid">
              {currentPath !== '/' && (
                <div className="file-item" onDoubleClick={goBack}>
                  <div className="file-icon">📁</div>
                  <div className="file-name">..</div>
                </div>
              )}
              {files.map((file) => (
                <div
                  key={file.name}
                  className={`file-item${selectedFile === file ? ' selected' : ''}`}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => handleDblClick(file)}
                  onContextMenu={(event) => showContextMenu(event, file)}
                >
                  <div className="file-icon">{file.type === 'directory' ? '📁' : getFileIcon(file.name)}</div>
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">{file.type === 'file' ? formatSize(file.size) : ''}</div>
                </div>
              ))}
              {!loading && files.length === 0 && (
                <div className="file-empty">
                  <div className="file-empty-icon">📂</div>
                  <p>当前目录为空</p>
                </div>
              )}
            </div>
          </Spin>

          <div className="file-status-bar">
            <span>{files.length} 个项目</span>
            <span>{selectedFile ? `已选择: ${selectedFile.name}` : ''}</span>
          </div>
        </div>
      </Modal>

      {contextMenu.visible && (
        <div
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu((menu) => ({ ...menu, visible: false }))}
        >
          {contextMenu.file?.type === 'file' && isEditable(contextMenu.file.name) && (
            <div className="file-menu-item" onClick={() => editFile(contextMenu.file)}>
              <EditOutlined /> 编辑
            </div>
          )}
          {contextMenu.file?.type === 'file' && (
            <div className="file-menu-item" onClick={() => downloadFile(contextMenu.file)}>
              <DownloadOutlined /> 下载
            </div>
          )}
          <div className="file-menu-item" onClick={() => renameItem(contextMenu.file)}>
            <EditOutlined /> 重命名
          </div>
          <div className="file-menu-item danger" onClick={() => deleteItem(contextMenu.file)}>
            <DeleteOutlined /> 删除
          </div>
        </div>
      )}

      <Modal
        title="新建文件夹"
        open={showNewFolderDialog}
        onCancel={() => setShowNewFolderDialog(false)}
        onOk={createFolder}
        confirmLoading={creating}
        okText="创建"
        width={400}
        destroyOnClose
      >
        <Input
          value={newFolderName}
          prefix={<FolderOutlined />}
          placeholder="文件夹名称"
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={createFolder}
        />
      </Modal>

      <Modal
        title="上传文件"
        open={showUploadDialog}
        onCancel={() => {
          setShowUploadDialog(false)
          setUploadFiles([])
        }}
        onOk={startUpload}
        confirmLoading={uploading}
        okText={`上传 ${uploadFiles.length} 个文件`}
        okButtonProps={{ disabled: uploadFiles.length === 0 }}
        width={550}
        destroyOnClose
      >
        <Upload.Dragger
          multiple
          beforeUpload={() => false}
          fileList={uploadFiles}
          onChange={({ fileList }) => setUploadFiles(fileList)}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined style={{ fontSize: 48, color: '#409eff' }} />
          </p>
          <p className="ant-upload-text">拖拽文件到此处，或点击上传</p>
        </Upload.Dragger>
        <div style={{ marginTop: 8, color: '#909399', fontSize: 12 }}>上传到: {currentPath}</div>
      </Modal>

      <Modal
        title={`编辑: ${editingFile?.name || ''}`}
        open={showEditDialog}
        onCancel={() => setShowEditDialog(false)}
        onOk={saveFile}
        confirmLoading={savingFile}
        okText="保存"
        width={900}
        style={{ top: '3vh' }}
        maskClosable={false}
        destroyOnClose
      >
        <Spin spinning={loadingContent}>
          <div className="file-editor-wrap">
            <Input.TextArea
              className="file-code-editor"
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              rows={22}
            />
          </div>
        </Spin>
      </Modal>

      <Modal
        title="重命名"
        open={showRenameDialog}
        onCancel={() => setShowRenameDialog(false)}
        onOk={doRename}
        confirmLoading={renaming}
        width={400}
        destroyOnClose
      >
        <Input
          value={newName}
          prefix={<EditOutlined />}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={doRename}
        />
      </Modal>
    </>
  )
}
