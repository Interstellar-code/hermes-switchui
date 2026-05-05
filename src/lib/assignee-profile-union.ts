export type AssigneeOption = { id: string; label: string; onDisk: boolean; isActive?: boolean }

export function unionAssigneesWithProfiles(
  assignees: Array<{ id: string; label: string; onDisk: boolean }>,
  profiles: Array<{ name: string }>,
  activeProfile?: string | null,
): Array<AssigneeOption> {
  const profileNames = new Set(profiles.map(p => p.name))

  const onDiskItems: AssigneeOption[] = profiles.map(p => ({
    id: p.name,
    label: p.name === activeProfile ? `${p.name} (active)` : p.name,
    onDisk: true,
    isActive: p.name === activeProfile,
  }))

  const orphanItems: AssigneeOption[] = assignees
    .filter(a => !profileNames.has(a.id))
    .map(a => ({ id: a.id, label: a.label, onDisk: false }))

  onDiskItems.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1
    if (!a.isActive && b.isActive) return 1
    return a.id.localeCompare(b.id)
  })

  orphanItems.sort((a, b) => a.id.localeCompare(b.id))

  return [...onDiskItems, ...orphanItems]
}
