import { useCallback, useState } from 'react'
import { TerminalChooser } from './TerminalChooser.js'
import { TerminalSession } from './TerminalSession.js'
import type { LaunchOptions } from './launch-options.js'
import { useViewStore } from '../view/viewStore.js'

export function TerminalPanel() {
  const [opts, setOpts] = useState<LaunchOptions | null>(null)
  const handleLaunch = useCallback((o: LaunchOptions) => {
    setOpts(o)
    if (o.resumeId) void useViewStore.getState().selectConversation(o.resumeId)
  }, [])
  const handleExit = useCallback(() => setOpts(null), [])
  if (!opts) return <TerminalChooser onLaunch={handleLaunch} />
  return <TerminalSession opts={opts} onExit={handleExit} />
}
