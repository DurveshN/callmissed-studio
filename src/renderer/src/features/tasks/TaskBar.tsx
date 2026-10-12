import { FloatingBar } from '../../ui/FloatingBar'
import { cancelTask, useTaskStore } from './task'

/** Progress of the running one-shot task (e.g. background removal), with Cancel. */
export function TaskBar() {
  const { label, progress } = useTaskStore()
  if (!label) return null
  return (
    <FloatingBar
      testId="task-bar"
      status="busy"
      text={label}
      icon={null}
      busy
      progress={progress}
      onClose={cancelTask}
      closeLabel="Cancel"
    />
  )
}
