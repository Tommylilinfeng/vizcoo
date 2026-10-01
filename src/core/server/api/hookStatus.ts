import { status, install, uninstall } from '../../hooks/install.js'

export function hookStatusEndpoint(currentPort: number): { installed: boolean; port: number | null; portMatchesCurrent: boolean; settingsPath: string } {
  const s = status()
  return { ...s, portMatchesCurrent: s.port === currentPort }
}

export function hookInstallEndpoint(currentPort: number): { installed: boolean; port: number } {
  install(currentPort)
  return { installed: true, port: currentPort }
}

export function hookUninstallEndpoint(): { installed: false } {
  uninstall()
  return { installed: false }
}
