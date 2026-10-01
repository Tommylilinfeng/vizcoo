import { useEffect, useRef, useState } from 'react'
import type { TurnSummary } from '../api.js'
import type { NodeId } from './types.js'

interface Pos { sx: number; sy: number }

export interface TurnSummaryChipsProps {
  summaries: TurnSummary[]
  isLive: boolean
  fontSize: number
  topLevelScreen: Map<NodeId, Pos>
  onSelect: (summary: TurnSummary) => void
}

const MAX_DISPLAY_CHARS = 26

export function TurnSummaryChips({ summaries, isLive, fontSize, topLevelScreen, onSelect }: TurnSummaryChipsProps) {
  if (summaries.length === 0) return null
  return (
    <g>
      {summaries.map((s) => {
        const pos = topLevelScreen.get(s.moduleId)
        if (!pos) return null
        return <Chip key={s.id} summary={s} isLive={isLive} fontSize={fontSize} pos={pos} onSelect={onSelect} />
      })}
    </g>
  )
}

function Chip({ summary, isLive, fontSize, pos, onSelect }: { summary: TurnSummary; isLive: boolean; fontSize: number; pos: Pos; onSelect: (s: TurnSummary) => void }) {
  const text = truncate(summary.summary, MAX_DISPLAY_CHARS)
  const charW = fontSize * 0.95
  const padX = 8
  const padY = 5
  const w = Math.max(40, text.length * charW + padX * 2)
  const h = fontSize + padY * 2
  const x = pos.sx - w / 2
  const y = pos.sy - 60

  const inProgress = isLive && !summary.finalized
  const stroke = inProgress ? '#34d399' : 'rgba(255,255,255,0.25)'

  const lastUpdateRef = useRef<string>(summary.updatedAt)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (lastUpdateRef.current === summary.updatedAt) return
    lastUpdateRef.current = summary.updatedAt
    if (!isLive) return
    setPulse(true)
    const t = window.setTimeout(() => setPulse(false), 700)
    return () => window.clearTimeout(t)
  }, [summary.updatedAt, isLive])

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onSelect(summary) }}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={5}
        fill="rgba(15,15,15,0.92)"
        stroke={stroke}
        strokeOpacity={pulse ? 1 : 0.7}
        strokeWidth={pulse ? 1.5 : 0.8}
        style={{ transition: 'stroke-opacity 0.4s, stroke-width 0.4s' }}
      />
      <text
        x={pos.sx} y={y + h / 2 + fontSize / 3}
        textAnchor="middle"
        fontSize={fontSize}
        fill="#e5e5e5"
        fontFamily="ui-sans-serif, system-ui, 'PingFang SC', sans-serif"
      >{text}</text>
      {inProgress && (
        <circle cx={x + w - 6} cy={y + 6} r={2.5} fill="#34d399">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
