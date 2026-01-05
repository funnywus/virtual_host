<template>
  <el-dialog v-model="visible" :title="'🖥️ ' + server?.name + ' - 终端'" width="900px" top="3vh" :close-on-click-modal="false" @closed="cleanup">
    <div class="terminal-container">
      <div class="terminal-toolbar">
        <div class="server-info">
          <el-tag type="success" size="small">{{ server?.username }}@{{ server?.ip }}</el-tag>
          <el-tag v-if="connected" type="success" size="small">已连接</el-tag>
          <el-tag v-else type="danger" size="small">未连接</el-tag>
        </div>
        <div class="toolbar-actions">
          <el-button size="small" @click="clearTerminal">清屏</el-button>
          <el-button size="small" type="primary" @click="reconnect" :loading="connecting">重连</el-button>
        </div>
      </div>
      <div ref="terminalRef" class="terminal-wrapper"></div>
      <div class="command-input">
        <el-input v-model="command" placeholder="输入命令后按回车执行" @keyup.enter="executeCommand" :disabled="!connected || executing">
          <template #prepend>$</template>
          <template #append>
            <el-button @click="executeCommand" :loading="executing" :disabled="!connected">执行</el-button>
          </template>
        </el-input>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import api from '@/api'

const props = defineProps({ modelValue: Boolean, server: Object })
const emit = defineEmits(['update:modelValue'])

const visible = ref(false)
const terminalRef = ref(null)
const connected = ref(false)
const connecting = ref(false)
const executing = ref(false)
const command = ref('')

let terminal = null
let fitAddon = null

watch(() => props.modelValue, async (val) => {
  visible.value = val
  if (val && props.server) {
    await nextTick()
    initTerminal()
    connect()
  }
})

watch(visible, (val) => emit('update:modelValue', val))

function initTerminal() {
  if (terminal) {
    terminal.dispose()
  }
  
  terminal = new Terminal({
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1e1e1e',
      selection: 'rgba(255, 255, 255, 0.3)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff'
    },
    fontSize: 14,
    fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 1000,
    convertEol: true
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  
  terminal.open(terminalRef.value)
  fitAddon.fit()
  
  terminal.writeln('\x1b[1;34m╔════════════════════════════════════════╗\x1b[0m')
  terminal.writeln('\x1b[1;34m║\x1b[0m   \x1b[1;32m🖥️  Web Terminal\x1b[0m                      \x1b[1;34m║\x1b[0m')
  terminal.writeln('\x1b[1;34m╚════════════════════════════════════════╝\x1b[0m')
  terminal.writeln('')
}

async function connect() {
  if (!props.server) return
  connecting.value = true
  
  try {
    terminal.writeln(`\x1b[33m正在连接 ${props.server.ip}:${props.server.port}...\x1b[0m`)
    const res = await api.post(`/servers/${props.server.id}/test`)
    if (res.success) {
      connected.value = true
      terminal.writeln(`\x1b[32m✓ 连接成功！延迟: ${res.latency}ms\x1b[0m`)
      terminal.writeln('')
      terminal.writeln('\x1b[36m提示: 在下方输入框输入命令，按回车执行\x1b[0m')
      terminal.writeln('')
    } else {
      connected.value = false
      terminal.writeln(`\x1b[31m✗ 连接失败: ${res.message}\x1b[0m`)
    }
  } catch (e) {
    connected.value = false
    terminal.writeln(`\x1b[31m✗ 连接错误: ${e.message}\x1b[0m`)
  } finally {
    connecting.value = false
  }
}

async function executeCommand() {
  if (!command.value.trim() || !connected.value || executing.value) return
  
  const cmd = command.value.trim()
  command.value = ''
  executing.value = true
  
  terminal.writeln(`\x1b[1;33m$ ${cmd}\x1b[0m`)
  
  try {
    const res = await api.post(`/servers/${props.server.id}/exec`, { command: cmd })
    if (res.output) {
      // 处理输出，保留颜色
      const lines = res.output.split('\n')
      lines.forEach(line => {
        terminal.writeln(line)
      })
    }
    if (res.error) {
      terminal.writeln(`\x1b[31m${res.error}\x1b[0m`)
    }
    terminal.writeln('')
  } catch (e) {
    terminal.writeln(`\x1b[31m执行错误: ${e.message}\x1b[0m`)
    terminal.writeln('')
  } finally {
    executing.value = false
  }
}

function clearTerminal() {
  if (terminal) {
    terminal.clear()
    terminal.writeln('\x1b[32m终端已清屏\x1b[0m')
    terminal.writeln('')
  }
}

function reconnect() {
  if (terminal) {
    terminal.clear()
  }
  initTerminal()
  connect()
}

function cleanup() {
  if (terminal) {
    terminal.dispose()
    terminal = null
  }
  connected.value = false
  command.value = ''
}

onUnmounted(() => {
  cleanup()
})
</script>

<style scoped>
.terminal-container { background: #1e1e1e; border-radius: 8px; overflow: hidden; }
.terminal-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #2d2d2d; border-bottom: 1px solid #404040; }
.server-info { display: flex; gap: 8px; }
.toolbar-actions { display: flex; gap: 8px; }
.terminal-wrapper { height: 400px; padding: 10px; }
.command-input { padding: 10px 15px; background: #2d2d2d; border-top: 1px solid #404040; }
.command-input :deep(.el-input__wrapper) { background: #1e1e1e; }
.command-input :deep(.el-input__inner) { color: #d4d4d4; }
.command-input :deep(.el-input-group__prepend) { background: #1e1e1e; color: #0dbc79; border-color: #404040; }
.command-input :deep(.el-input-group__append) { background: #2d2d2d; border-color: #404040; }
</style>
