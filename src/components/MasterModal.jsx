import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { projectMembersOf, sortedMembers } from '../lib/members.js'
import { ColorPickerSwatch, SettingsAccordion } from './settingsShared.jsx'

// マスタ: プロジェクト・メンバーは設定と切り離して独立管理する。
export default function MasterModal({ onClose }) {
  const { state, actions } = useStore()
  const [newProj, setNewProj] = useState('')
  const [newMember, setNewMember] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [openSection, setOpenSection] = useState('projects')

  function toggleSection(id) {
    setOpenSection((prev) => (prev === id ? null : id))
  }

  const sortedProjs = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)
  const allMembers = sortedMembers(state.members)

  function submitProject() {
    if (newProj.trim()) {
      actions.addProject(newProj)
      setNewProj('')
    }
  }

  function submitMember() {
    if (newMember.trim()) {
      actions.addMember(newMember)
      setNewMember('')
    }
  }

  return (
    <>
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <h2>マスタ</h2>

        <div className="settings-acc-list">
          <SettingsAccordion
            id="projects"
            title="プロジェクト"
            meta={sortedProjs.length}
            openId={openSection}
            onToggle={toggleSection}
          >
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              タスクをまとめる大枠。カレンダーではプロジェクトの色でラベルを見分けられます。非表示にするとカレンダー・WBSから隠れます。「メンバー」で担当者の候補になる所属メンバーを選べます。
            </p>
            <div className="settings-list">
              {sortedProjs.map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </div>
            <div className="cat-edit-row">
              <input
                type="text"
                value={newProj}
                placeholder="新しいプロジェクト"
                onChange={(e) => setNewProj(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitProject()
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={submitProject}>
                追加
              </button>
            </div>
          </SettingsAccordion>

          <SettingsAccordion
            id="members"
            title="メンバー"
            meta={allMembers.length}
            openId={openSection}
            onToggle={toggleSection}
          >
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              タスクの担当者として割り当てる人。プロジェクト設定で所属させると、そのプロジェクトのタスクで担当者候補に出ます（プロジェクト未設定のタスクでは全員が候補）。
            </p>
            <div className="settings-list">
              {allMembers.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </div>
            <div className="cat-edit-row">
              <input
                type="text"
                value={newMember}
                placeholder="新しいメンバー（例: 山田）"
                onChange={(e) => setNewMember(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitMember()
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={submitMember}>
                追加
              </button>
            </div>
          </SettingsAccordion>
        </div>
      </div>
    </div>
    {confirm && (
      <ConfirmDialog
        message={confirm.message}
        detail={confirm.detail}
        okLabel={confirm.okLabel}
        danger={confirm.danger}
        onOk={confirm.onOk}
        onCancel={() => setConfirm(null)}
      />
    )}
    </>
  )
}

function MemberRow({ member }) {
  const { state, actions } = useStore()
  const [name, setName] = useState(member.name)
  const [confirm, setConfirm] = useState(null)
  const color = member.color || ''
  const assignedCount = (state.taskAssignees ?? []).filter((a) => a.member_id === member.id).length

  return (
    <>
    <div className="cat-edit-row">
      <ColorPickerSwatch
        color={color}
        onChange={(c) => actions.updateMember(member.id, { color: c })}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (n && n !== member.name) actions.updateMember(member.id, { name: n })
          else setName(member.name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = name.trim()
            if (n && n !== member.name) actions.updateMember(member.id, { name: n })
            e.target.blur()
          }
        }}
      />
      <button
        className="btn btn-sm btn-icon-del"
        onClick={() =>
          setConfirm({
            message: `「${member.name}」を削除しますか？`,
            detail: assignedCount
              ? `担当中の ${assignedCount} 件のタスクから外れ、全プロジェクトの所属からも外れます。`
              : '全プロジェクトの所属からも外れます。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteMember(member.id) },
          })
        }
        title="削除"
        aria-label="削除"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
    )}
    </>
  )
}

function ProjectMembersEditor({ project, onConfirm }) {
  const { state, actions } = useStore()
  const all = sortedMembers(state.members)
  const inProject = new Set(projectMembersOf(project.id, state).map((m) => m.id))
  const projectTaskIds = new Set(state.tasks.filter((t) => t.project_id === project.id).map((t) => t.id))

  function toggle(m) {
    if (!inProject.has(m.id)) {
      actions.addProjectMember(project.id, m.id)
      return
    }
    const affected = (state.taskAssignees ?? []).filter(
      (a) => a.member_id === m.id && projectTaskIds.has(a.task_id),
    ).length
    if (!affected) {
      actions.removeProjectMember(project.id, m.id)
      return
    }
    onConfirm({
      message: `「${m.name}」を「${project.name}」から外しますか？`,
      detail: `このプロジェクトの ${affected} 件のタスクから担当が外れます。`,
      okLabel: '外す',
      danger: true,
      onOk: () => actions.removeProjectMember(project.id, m.id),
    })
  }

  if (all.length === 0) {
    return <p className="help project-members-empty">先に「メンバー」でメンバーを追加してください。</p>
  }
  return (
    <div className="project-members" role="group" aria-label={`${project.name} の所属メンバー`}>
      {all.map((m) => (
        <label key={m.id} className="project-member-check">
          <input type="checkbox" checked={inProject.has(m.id)} onChange={() => toggle(m)} />
          <span className="tag-dot" style={{ background: m.color || 'var(--rule-strong)' }} />
          {m.name}
        </label>
      ))}
    </div>
  )
}

function ProjectRow({ project }) {
  const { state, actions } = useStore()
  const [name, setName] = useState(project.name)
  const [confirm, setConfirm] = useState(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const color = project.color || ''
  const hidden = Boolean(project.hidden)
  const memberCount = projectMembersOf(project.id, state).length

  return (
    <>
    <div className={`cat-edit-row${hidden ? ' is-hidden' : ''}`}>
      <ColorPickerSwatch
        color={color}
        onChange={(c) => actions.updateProject(project.id, { color: c })}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (n && n !== project.name) actions.updateProject(project.id, { name: n })
          else setName(project.name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = name.trim()
            if (n && n !== project.name) actions.updateProject(project.id, { name: n })
            e.target.blur()
          }
        }}
      />
      <button
        className="btn btn-sm"
        onClick={() => actions.updateProject(project.id, { hidden: !hidden })}
        title={hidden ? '表示する' : '非表示にする'}
      >
        {hidden ? '表示' : '非表示'}
      </button>
      <button
        className={`btn btn-sm${membersOpen ? ' active' : ''}`}
        onClick={() => setMembersOpen((v) => !v)}
        aria-expanded={membersOpen}
        title="所属メンバーを編集"
      >
        メンバー {memberCount}
      </button>
      <button
        className="btn btn-sm btn-icon-del"
        onClick={() =>
          setConfirm({
            message: `「${project.name}」を削除しますか？`,
            detail: 'このプロジェクトのタスクはプロジェクトなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteProject(project.id) },
          })
        }
        title="削除"
        aria-label="削除"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
    {membersOpen && (
      <ProjectMembersEditor
        project={project}
        onConfirm={(c) => setConfirm({ ...c, onOk: () => { setConfirm(null); c.onOk() } })}
      />
    )}
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
    )}
    </>
  )
}
