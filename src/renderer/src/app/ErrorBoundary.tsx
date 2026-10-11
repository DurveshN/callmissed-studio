import { Component, type ErrorInfo, type ReactNode } from 'react'
import ui from '../ui/ui.module.css'
import styles from './App.module.css'

interface State {
  error: Error | null
}

/** Last line of defence: shows a recovery screen instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className={styles.crash} role="alert">
        <h1>Something went wrong</h1>
        <p>Your work is autosaved. Reload to continue — unsaved changes will be offered for recovery.</p>
        <pre>{this.state.error.message}</pre>
        <button className={ui.primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
