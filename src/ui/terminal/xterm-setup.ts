import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

export interface TerminalBundle {
  term: Terminal
  fit: FitAddon
  dispose(): void
}

export type TermThemePref = 'match' | 'dark' | 'light'
export const TERM_THEME_PREF_KEY = 'vizcoo.termTheme'
export const TERM_THEME_EVENT = 'vizcoo:termtheme'

export const TERM_THEME_DARK: ITheme = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#262626',
  black: '#000000',
  red: '#ef4444',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d4',
  brightBlack: '#525252',
  brightRed: '#f87171',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa',
}

export const TERM_THEME_LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#000000',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selectionBackground: '#b3d4fc',
  black: '#000000',
  red: '#c23621',
  green: '#25bc24',
  yellow: '#adad27',
  blue: '#492ee1',
  magenta: '#d338d3',
  cyan: '#33bbc8',
  white: '#cbcccd',
  brightBlack: '#818383',
  brightRed: '#fc391f',
  brightGreen: '#31e722',
  brightYellow: '#eaec23',
  brightBlue: '#5833ff',
  brightMagenta: '#f935f8',
  brightCyan: '#14f0f0',
  brightWhite: '#e9ebeb',
}

export function readTermThemePref(): TermThemePref {
  if (typeof window === 'undefined') return 'match'
  const v = window.localStorage.getItem(TERM_THEME_PREF_KEY)
  return v === 'dark' || v === 'light' ? v : 'match'
}

export function writeTermThemePref(pref: TermThemePref): void {
  window.localStorage.setItem(TERM_THEME_PREF_KEY, pref)
  window.dispatchEvent(new Event(TERM_THEME_EVENT))
}

export function resolveTermTheme(pref: TermThemePref = readTermThemePref()): ITheme {
  if (pref === 'dark') return TERM_THEME_DARK
  if (pref === 'light') return TERM_THEME_LIGHT
  const appTheme = document.documentElement.getAttribute('data-theme')
  return appTheme === 'light' ? TERM_THEME_LIGHT : TERM_THEME_DARK
}

export function createTerminal(theme: ITheme = resolveTermTheme()): TerminalBundle {
  const term = new Terminal({
    fontFamily: 'Geist Mono, JetBrains Mono, SF Mono, Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme,
  })
  const fit = new FitAddon()
  const links = new WebLinksAddon()
  term.loadAddon(fit)
  term.loadAddon(links)
  return {
    term,
    fit,
    dispose() { term.dispose() },
  }
}
