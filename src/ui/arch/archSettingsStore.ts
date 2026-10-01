import { create } from 'zustand'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ArchSettings } from './settings.js'

interface ArchSettingsStore {
  settings: ArchSettings
  set: (next: Partial<ArchSettings>) => void
  reset: () => void
}

export const useArchSettings = create<ArchSettingsStore>((set) => ({
  settings: typeof window === 'undefined' ? DEFAULT_SETTINGS : loadSettings(),
  set: (next) => set((s) => {
    const merged = { ...s.settings, ...next }
    saveSettings(merged)
    return { settings: merged }
  }),
  reset: () => set(() => {
    saveSettings(DEFAULT_SETTINGS)
    return { settings: { ...DEFAULT_SETTINGS } }
  }),
}))
