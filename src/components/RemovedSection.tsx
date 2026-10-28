import { ArchiveRestore, RotateCcw, Trash2 } from 'lucide-react'
import type { Task } from '../lib/supabase'
import { LoadingRows } from './LoadingRows'

type RemovedSectionProps = {
  tasks: Task[]
  loaded: boolean
  isOnline: boolean
  clearing: boolean
  onRestore(task: Task): void
  onPurge(task: Task): void
  onClearAll(): void
}

export function RemovedSection({ tasks, loaded, isOnline, clearing, onRestore, onPurge, onClearAll }: RemovedSectionProps) {
  return <section className="removed-section"><div className="removed-heading"><h2><ArchiveRestore size={17}/>Recently removed</h2>{tasks.length > 0 && <button className="secondary-button" disabled={!isOnline || clearing} onClick={onClearAll}>{clearing ? 'Clearing…' : 'Clear all'}</button>}</div>
    {tasks.length ? tasks.map(task => <div className="removed-row" key={task.id}><span>{task.title}</span><div className="removed-actions"><button className="secondary-button" disabled={!isOnline} onClick={() => onRestore(task)}><RotateCcw size={14}/>Restore</button><button className="icon-button remove-button" aria-label={`Delete ${task.title} for good`} title="Delete for good" disabled={!isOnline} onClick={() => onPurge(task)}><Trash2 size={16}/></button></div></div>)
      : loaded ? <p className="removed-empty">Removed tasks can be restored here.</p> : <LoadingRows/>}
  </section>
}
