import { spawn, type ChildProcess } from 'node:child_process'

export interface RunningProcess {
  child: ChildProcess
  cancel: () => void
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>
}

export function terminateProcess(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform
): void {
  if (child.pid == null || child.exitCode != null) return
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
  const timer = setTimeout(() => {
    if (child.exitCode == null) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }, 2000)
  timer.unref?.()
  child.once('exit', () => clearTimeout(timer))
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal } = {}
): RunningProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_000)
  })

  let settled = false
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve, reject) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return
        settled = true
        resolve({ code, signal, stderr })
      }
      child.once('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      child.once('exit', (code, signal) => finish(code, signal))
    }
  )

  const cancel = () => terminateProcess(child)
  if (options.signal) {
    if (options.signal.aborted) cancel()
    else options.signal.addEventListener('abort', cancel, { once: true })
  }

  return { child, cancel, done }
}
