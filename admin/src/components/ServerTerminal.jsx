import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Tag } from 'antd'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import api from '@/api'
import './ServerTerminal.css'

export default function ServerTerminal({ open, server, onClose }) {
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const terminalRef = useRef(null)
  const fitAddonRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [command, setCommand] = useState('')

  function writeLine(text) {
    try {
      terminalRef.current?.writeln(text)
    } catch {
      // 终端已销毁
    }
  }

  function disposeTerminal() {
    if (terminalRef.current) {
      try {
        terminalRef.current.dispose()
      } catch {
        // 已销毁
      }
      terminalRef.current = null
    }
    fitAddonRef.current = null
  }

  function initTerminal() {
    disposeTerminal()
    if (!wrapperRef.current) return

    const terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selection: 'rgba(255, 255, 255, 0.3)',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
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

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(wrapperRef.current)
    requestAnimationFrame(() => fitAddon.fit())

    terminal.writeln('\x1b[1;34m╔════════════════════════════════════════╗\x1b[0m')
    terminal.writeln('\x1b[1;34m║\x1b[0m   \x1b[1;32m🖥️  Web Terminal\x1b[0m                      \x1b[1;34m║\x1b[0m')
    terminal.writeln('\x1b[1;34m╚════════════════════════════════════════╝\x1b[0m')
    terminal.writeln('')

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
  }

  async function connect() {
    if (!server) return
    setConnecting(true)
    try {
      writeLine(`\x1b[33m正在连接 ${server.ip}:${server.port}...\x1b[0m`)
      const res = await api.post(`/servers/${server.id}/test`)
      if (res.success) {
        setConnected(true)
        writeLine(`\x1b[32m✓ 连接成功！延迟: ${res.latency}ms\x1b[0m`)
        writeLine('')
        writeLine('\x1b[36m提示: 在下方输入框输入命令，按回车执行\x1b[0m')
        writeLine('')
        window.setTimeout(() => inputRef.current?.focus(), 0)
      } else {
        setConnected(false)
        writeLine(`\x1b[31m✗ 连接失败: ${res.message}\x1b[0m`)
      }
    } catch (e) {
      setConnected(false)
      writeLine(`\x1b[31m✗ 连接错误: ${e.message}\x1b[0m`)
    } finally {
      setConnecting(false)
    }
  }

  async function executeCommand() {
    const cmd = command.trim()
    if (!cmd || !connected || executing) return
    setCommand('')
    setExecuting(true)
    writeLine(`\x1b[1;33m$ ${cmd}\x1b[0m`)
    try {
      const res = await api.post(`/servers/${server.id}/exec`, { command: cmd })
      if (res.output) {
        res.output.split('\n').forEach((line) => writeLine(line))
      }
      if (res.error) {
        writeLine(`\x1b[31m${res.error}\x1b[0m`)
      }
      writeLine('')
    } catch (e) {
      writeLine(`\x1b[31m执行错误: ${e.message}\x1b[0m`)
      writeLine('')
    } finally {
      setExecuting(false)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  function clearTerminal() {
    if (!terminalRef.current) return
    terminalRef.current.clear()
    writeLine('\x1b[32m终端已清屏\x1b[0m')
    writeLine('')
  }

  function reconnect() {
    if (terminalRef.current) terminalRef.current.clear()
    initTerminal()
    connect()
  }

  function cleanup() {
    disposeTerminal()
    setConnected(false)
    setCommand('')
  }

  function handleAfterOpenChange(visible) {
    if (!visible || !server) return
    initTerminal()
    connect()
  }

  useEffect(() => () => cleanup(), [])

  return (
    <Modal
      title={`🖥️ ${server?.name} - 终端`}
      open={open}
      onCancel={onClose}
      afterOpenChange={handleAfterOpenChange}
      afterClose={cleanup}
      footer={null}
      width={900}
      style={{ top: '3vh' }}
      maskClosable={false}
      destroyOnClose
    >
      <div className="terminal-container">
        <div className="terminal-toolbar">
          <div className="terminal-server-info">
            <Tag color="success">{server?.username}@{server?.ip}</Tag>
            {connected
              ? <Tag color="success">已连接</Tag>
              : <Tag color="error">未连接</Tag>}
          </div>
          <div className="terminal-toolbar-actions">
            <Button size="small" onClick={clearTerminal}>清屏</Button>
            <Button size="small" type="primary" loading={connecting} onClick={reconnect}>重连</Button>
          </div>
        </div>
        <div ref={wrapperRef} className="terminal-wrapper" />
        <div className="terminal-command">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              ref={inputRef}
              prefix="$"
              value={command}
              placeholder="输入命令后按回车执行"
              disabled={!connected || executing}
              onChange={(e) => setCommand(e.target.value)}
              onPressEnter={executeCommand}
            />
            <Button type="primary" loading={executing} disabled={!connected} onClick={executeCommand}>
              执行
            </Button>
          </Space.Compact>
        </div>
      </div>
    </Modal>
  )
}
