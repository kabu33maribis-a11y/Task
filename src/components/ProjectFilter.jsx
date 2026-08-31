import { useStore } from '../store/StoreContext.jsx'

// Shared project scope selector. value: 'all' | projectId.
// Renders color-coded pills: 「すべて」 + each project.
export default function ProjectFilter({ value, onChange }) {
  const { state } = useStore()
  const projects = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)

  if (projects.length === 0) return null

  return (
    <div className="project-filter" role="tablist" aria-label="プロジェクト絞り込み">
      <button
        className={`proj-pill${value === 'all' ? ' active' : ''}`}
        onClick={() => onChange('all')}
      >
        すべて
      </button>
      {projects.map((p) => (
        <button
          key={p.id}
          className={`proj-pill${value === p.id ? ' active' : ''}`}
          onClick={() => onChange(p.id)}
          style={value === p.id && p.color ? { borderColor: p.color, background: p.color + '22' } : undefined}
        >
          {p.color && <span className="proj-dot" style={{ background: p.color }} />}
          {p.name}
        </button>
      ))}
    </div>
  )
}
