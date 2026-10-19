import { spawn } from 'node:child_process'

let child
let timer
let stopping = false
function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/collector.ts'], { stdio: 'inherit' })
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`collector supervisor: salida ${code ?? signal}; reinicio en 5 segundos`)
    timer = setTimeout(start, 5000)
  })
  child.once('error', error => console.error('collector supervisor:', error.message))
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    clearTimeout(timer)
    child?.kill(signal)
  })
}
start()
