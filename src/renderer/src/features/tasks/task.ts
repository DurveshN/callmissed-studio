import { create } from 'zustand'
import { notify } from '../../ui/notify'
import { MlError } from '../ml/ml-client'

interface TaskState {
  /** What is running (null when idle). */
  label: string | null
  progress: number | null
  controller: AbortController | null
}

export const useTaskStore = create<TaskState>()(() => ({ label: null, progress: null, controller: null }))

/**
 * Runs a one-shot image task with a progress bar and Cancel (one at a time). `report` updates the
 * label and progress. Failures are shown as a toast; cancelling is silent.
 */
export async function runTask(
  label: string,
  work: (signal: AbortSignal, report: (progress: number | null, label?: string) => void) => Promise<void>
): Promise<void> {
  if (useTaskStore.getState().label) {
    notify.info('Please wait for the current task to finish.')
    return
  }
  const controller = new AbortController()
  useTaskStore.setState({ label, progress: null, controller })
  try {
    await work(controller.signal, (progress, next) =>
      useTaskStore.setState(next ? { progress, label: next } : { progress })
    )
  } catch (error) {
    if (!(error instanceof MlError && error.code === 'CANCELLED'))
      notify.error(error, `${label.replace(/…$/, '')} failed`)
  } finally {
    useTaskStore.setState({ label: null, progress: null, controller: null })
  }
}

export function cancelTask(): void {
  useTaskStore.getState().controller?.abort()
}
