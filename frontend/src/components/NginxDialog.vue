<template>
  <el-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" title="Nginx配置" width="800px" append-to-body>
    <div v-if="subdomain" style="margin-bottom:15px">
      <span>域名: <strong class="full-domain">{{ fullDomain }}</strong></span>
      <el-tag v-if="form.synced" type="success" size="small" style="margin-left:10px">已同步</el-tag>
    </div>

    <el-form :model="form" label-width="100px">
      <el-form-item label="配置类型">
        <el-radio-group v-model="form.type" @change="generateConfig">
          <el-radio-button value="http">HTTP</el-radio-button>
          <el-radio-button value="https">HTTPS</el-radio-button>
          <el-radio-button value="proxy">反向代理</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="网站目录" v-if="form.type !== 'proxy' && form.type !== 'custom'">
        <el-input v-model="form.root_path" @change="generateConfig" />
      </el-form-item>
      <el-form-item label="代理地址" v-if="form.type === 'proxy'">
        <el-input v-model="form.proxy_pass" placeholder="http://127.0.0.1:3000" @change="generateConfig" />
      </el-form-item>
      <el-form-item label="配置内容">
        <el-input v-model="form.config" type="textarea" :rows="15" style="font-family:monospace" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button @click="fetchConfig" :loading="fetching">从服务器获取</el-button>
      <el-button type="warning" @click="removeConfig" :loading="removing">删除配置</el-button>
      <el-button type="success" @click="syncConfig" :loading="syncing">同步到服务器</el-button>
      <el-button type="primary" @click="saveConfig" :loading="saving">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const props = defineProps({
  modelValue: Boolean,
  subdomain: Object
})
const emit = defineEmits(['update:modelValue', 'refresh'])

const form = reactive({
  type: 'https', config: '', root_path: '', proxy_pass: 'http://127.0.0.1:3000', synced: false
})

const saving = ref(false)
const syncing = ref(false)
const fetching = ref(false)
const removing = ref(false)

const fullDomain = computed(() => {
  if (!props.subdomain) return ''
  return props.subdomain.subdomain === '@' 
    ? props.subdomain.main_domain 
    : `${props.subdomain.subdomain}.${props.subdomain.main_domain}`
})

watch(() => props.modelValue, async (val) => {
  if (val && props.subdomain) {
    form.root_path = `/www/wwwroot/ftp/${fullDomain.value}`
    form.config = props.subdomain.nginx_config || ''
    form.synced = props.subdomain.nginx_synced === 1
    if (!form.config) {
      await generateConfig()
    }
  }
})

async function generateConfig() {
  if (form.type === 'custom') return
  try {
    const res = await api.post('/nginx/preview', {
      subdomain_id: props.subdomain.id,
      type: form.type,
      root_path: form.root_path,
      proxy_pass: form.proxy_pass
    })
    form.config = res.config
  } catch (e) {}
}

async function fetchConfig() {
  fetching.value = true
  try {
    const res = await api.get(`/nginx/fetch/${props.subdomain.id}`)
    if (res.config) {
      form.config = res.config
      ElMessage.success('获取成功')
    } else {
      ElMessage.warning('服务器上没有此配置文件')
    }
  } finally {
    fetching.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    await api.post(`/nginx/save/${props.subdomain.id}`, { config: form.config })
    ElMessage.success('保存成功')
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function syncConfig() {
  syncing.value = true
  try {
    const res = await api.post(`/nginx/sync/${props.subdomain.id}`, { config: form.config })
    if (res.success) {
      ElMessage.success('同步成功')
      form.synced = true
      emit('refresh')
    } else {
      ElMessage.error(res.message || '同步失败')
    }
  } finally {
    syncing.value = false
  }
}

async function removeConfig() {
  await ElMessageBox.confirm('确定删除服务器上的Nginx配置？', '提示')
  removing.value = true
  try {
    await api.delete(`/nginx/remove/${props.subdomain.id}`)
    ElMessage.success('删除成功')
    form.config = ''
    form.synced = false
    emit('refresh')
  } finally {
    removing.value = false
  }
}
</script>

<style scoped>
.full-domain { color: #409eff; font-weight: bold; }

/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  :deep(.el-dialog) {
    width: 95% !important;
    margin-top: 5vh !important;
  }

  :deep(.el-dialog__header) {
    padding: 15px;
  }

  :deep(.el-dialog__body) {
    padding: 15px;
    max-height: 70vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 15px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :deep(.el-dialog__footer .el-button) {
    flex: 1;
    min-width: calc(50% - 4px);
    margin: 0;
  }

  /* 表单优化 */
  :deep(.el-form-item) {
    margin-bottom: 15px;
  }

  :deep(.el-form-item__label) {
    font-size: 13px;
  }

  /* Radio Group 优化 */
  :deep(.el-radio-group) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :deep(.el-radio-button) {
    flex: 1;
    min-width: calc(50% - 4px);
  }

  :deep(.el-radio-button__inner) {
    width: 100%;
    font-size: 12px;
    padding: 8px 10px;
  }

  /* Textarea 优化 */
  :deep(.el-textarea__inner) {
    font-size: 12px;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  :deep(.el-radio-button) {
    flex: 1;
    min-width: 100%;
  }

  :deep(.el-dialog__footer .el-button) {
    min-width: 100%;
  }
}
</style>
