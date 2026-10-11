import { useEffect, useState } from 'react'
import type { Response } from '@shared/ipc/contracts'
import { call } from '../lib/ipc'
import styles from './App.module.css'

type AppInfo = Response<'app:get-info'>

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    call('app:get-info').then(setInfo).catch(console.error)
  }, [])

  return (
    <main className={styles.root}>
      <h1 className={styles.title}>CallMissed Studio</h1>
      <p className={styles.meta} data-testid="app-version">
        {info ? `v${info.version} · Electron ${info.electron}` : 'Loading…'}
      </p>
    </main>
  )
}
