<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="closeOnClickModal"
    class="app-dialog"
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <slot />

    <template v-if="showFooter" #footer>
      <slot name="footer">
        <div class="app-dialog-footer">
          <el-button @click="emit('update:modelValue', false)">{{ cancelText }}</el-button>
          <el-button type="primary" :loading="loading" @click="emit('confirm')">{{ confirmText }}</el-button>
        </div>
      </slot>
    </template>
  </el-dialog>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, default: '' },
  width: { type: String, default: '520px' },
  loading: { type: Boolean, default: false },
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  showFooter: { type: Boolean, default: true },
  closeOnClickModal: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])
</script>

<style>
.app-dialog {
  --app-dialog-padding: 24px;
}

.app-dialog .el-dialog__body {
  padding: var(--app-dialog-padding) !important;
}

.app-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.app-dialog-footer .el-button + .el-button {
  margin-left: 0 !important;
}

@media (max-width: 768px) {
  .app-dialog {
    width: min(94vw, 560px) !important;
    --app-dialog-padding: 16px;
  }

  .app-dialog-footer {
    flex-wrap: wrap;
  }
}
</style>
