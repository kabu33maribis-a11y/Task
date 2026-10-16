import { useState } from 'react'
import { Database, Eye, EyeOff, FolderKanban, Trash2, UserRound, Users } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { projectMembersOf, sortedMembers } from '../lib/members.js'
import {
  AddEntityBar,
  ChipToggle,
  EmptyState,
  EntityList,
  EntityRow,
  IconButton,
  MetaChip,
  SettingsShell,
} from './settingsShared.jsx'

// マスタ: プロジェクト・メンバーは設定と切り離して独立管理する。
export default function MasterModal({ onClose }) {
  const { state, actions } = useStore()
  const [tab, setTab] = useState('projects')

  const sortedProjs = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)
  const allMembers = sortedMembers(state.members)

  const tabs = [
    {
      id: 'projects',
      label: 'プロジェクト',
      icon: FolderKanban,
      meta: sortedProjs.length,
      description:
        'タスクをまとめる大枠。カレンダーではプロジェクトの色でラベルを見分けられます。非表示にするとカレンダー・WBSから隠れます。',
    },
    {
      id: 'members',
      label: 'メンバー',
      icon: Users,
      meta: allMembers.length,
      description:
        'タスクの担当者として割り当てる人。プロジェクトに所属させると、そのプロジェクトのタスクで担当者候補に出ます（プロジェクト未設定のタスクでは全員が候補）。',
    },
  ]

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <SettingsShell title="マスタ" icon={Database} tabs={tabs} activeId={tab} onChange={setTab} onClose={onClose}>
        {tab === 'projects' && (
          <>
            <EntityList
              empty={
                <EmptyState
                  icon={FolderKanban}
                  title="プロジェクトはまだありません"
                  hint="下の入力欄から追加すると、タスクをプロジェクトごとに色分けできます。"
                />
              }
            >
              {sortedProjs.map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </EntityList>
            <AddEntityBar placeholder="新しいプロジェクト名を入力して Enter" onAdd={(n) => actions.addProject(n)} />
          </>
        )}

        {tab === 'members' && (
          <>
            <EntityList
              empty={
                <EmptyState
                  icon={Users}
                  title="メンバーはまだいません"
                  hint="追加すると、タスクの担当者として割り当てられるようになります。"
                />
              }
            >
              {allMembers.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </EntityList>
            <AddEntityBar placeholder="新しいメンバー名（例: 山田）を入力して Enter" onAdd={(n) => actions.addMember(n)} />
          </>
        )}
      </SettingsShell>
    </div>
  )
}

function MemberRow({ member }) {
  const { state, actions } = useStore()
  const [confirm, setConfirm] = useState(null)
  const assignedCount = (state.taskAssignees ?? []).filter((a) => a.member_id === member.id).length
  const projectCount = (state.projectMembers ?? []).filter((pm) => pm.member_id === member.id).length

  return (
    <>
      <EntityRow
        color={member.color || ''}
        onColorChange={(c) => actions.updateMember(member.id, { color: c })}
        name={member.name}
        onRename={(n) => actions.updateMember(member.id, { name: n })}
        meta={
          <>
            <MetaChip>担当 {assignedCount} 件</MetaChip>
            <MetaChip>所属 {projectCount} プロジェクト</MetaChip>
          </>
        }
        actions={
          <IconButton
            icon={Trash2}
            label="削除"
            danger
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
          />
        }
      />
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
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

  return (
    <div className="entity-sub" role="group" aria-label={`${project.name} の所属メンバー`}>
      <div className="entity-sub-head">
        <UserRound size={13} strokeWidth={2} aria-hidden />
        <span>所属メンバー</span>
        <span className="entity-sub-count">
          {inProject.size} / {all.length}
        </span>
      </div>
      {all.length === 0 ? (
        <p className="entity-sub-empty">先に「メンバー」タブでメンバーを追加してください。</p>
      ) : (
        <div className="chip-group">
          {all.map((m) => (
            <ChipToggle key={m.id} on={inProject.has(m.id)} color={m.color || undefined} onClick={() => toggle(m)}>
              {m.name}
            </ChipToggle>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project }) {
  const { state, actions } = useStore()
  const [confirm, setConfirm] = useState(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const hidden = Boolean(project.hidden)
  const memberCount = projectMembersOf(project.id, state).length
  const taskCount = state.tasks.filter((t) => t.project_id === project.id).length

  return (
    <>
      <EntityRow
        color={project.color || ''}
        onColorChange={(c) => actions.updateProject(project.id, { color: c })}
        name={project.name}
        onRename={(n) => actions.updateProject(project.id, { name: n })}
        dimmed={hidden}
        meta={
          <>
            <MetaChip>タスク {taskCount} 件</MetaChip>
            {hidden && <MetaChip tone="muted">非表示</MetaChip>}
          </>
        }
        actions={
          <>
            <IconButton
              icon={hidden ? EyeOff : Eye}
              label={hidden ? '非表示中（クリックで表示）' : '表示中（クリックで非表示）'}
              aria-pressed={hidden}
              onClick={() => actions.updateProject(project.id, { hidden: !hidden })}
            />
            <IconButton
              icon={Users}
              label="所属メンバーを編集"
              active={membersOpen}
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((v) => !v)}
            >
              {memberCount}
            </IconButton>
            <IconButton
              icon={Trash2}
              label="削除"
              danger
              onClick={() =>
                setConfirm({
                  message: `「${project.name}」を削除しますか？`,
                  detail: taskCount
                    ? `${taskCount} 件のタスクはプロジェクトなしになります。`
                    : 'このプロジェクトのタスクはプロジェクトなしになります。',
                  okLabel: '削除する',
                  danger: true,
                  onOk: () => { setConfirm(null); actions.deleteProject(project.id) },
                })
              }
            />
          </>
        }
      >
        {membersOpen && (
          <ProjectMembersEditor
            project={project}
            onConfirm={(c) => setConfirm({ ...c, onOk: () => { setConfirm(null); c.onOk() } })}
          />
        )}
      </EntityRow>
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </>
  )
}
