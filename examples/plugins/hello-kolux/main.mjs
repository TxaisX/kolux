// Sample Kolux plugin worker entry. Runs inside the out-of-process plugin
// worker (plain Node, no Electron), forked lazily on the first trigger. The
// default export receives the `kolux` API: command registration, event
// handlers, and the capability-gated host API.
export default function activate(kolux) {
  kolux.commands.register('hello-ping', async (args) => {
    const stored = await kolux.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await kolux.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  kolux.events.on('worktree.created', async (payload) => {
    kolux.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await kolux.host.call('notifications.show', {
      title: 'Worktree created',
      body: payload.path
    })
  })

  kolux.events.on('agent.status.changed', (payload) => {
    kolux.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
