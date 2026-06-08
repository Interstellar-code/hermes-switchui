import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type UserCommandRecord = {
  id: string
  name: string
  slash: string
  description: string
  prompt: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type UserCommandInput = {
  name: string
  slash: string
  description?: string
  prompt: string
  enabled?: boolean
}

export type UserCommandPatch = Partial<UserCommandInput>

export const commandsKeys = {
  all: ['commands'] as const,
  list: () => ['commands', 'list'] as const,
}

async function commandsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`)
  }
  return payload as T
}

export async function fetchUserCommands(): Promise<Array<UserCommandRecord>> {
  const payload = await commandsJson<{ commands: Array<UserCommandRecord> }>(
    '/api/commands',
  )
  return payload.commands
}

export async function createUserCommandApi(
  input: UserCommandInput,
): Promise<UserCommandRecord> {
  const payload = await commandsJson<{ command: UserCommandRecord }>(
    '/api/commands',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return payload.command
}

export async function updateUserCommandApi(
  id: string,
  patch: UserCommandPatch,
): Promise<UserCommandRecord> {
  const payload = await commandsJson<{ command: UserCommandRecord }>(
    `/api/commands/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  return payload.command
}

export async function deleteUserCommandApi(id: string): Promise<void> {
  await commandsJson<{ ok: true }>(`/api/commands/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export function useUserCommands() {
  return useQuery({
    queryKey: commandsKeys.list(),
    queryFn: fetchUserCommands,
    staleTime: 15_000,
  })
}

export function useEnabledUserCommands() {
  const query = useUserCommands()
  return {
    ...query,
    data: (query.data ?? []).filter((command) => command.enabled),
  }
}

export function useCreateUserCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUserCommandApi,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commandsKeys.all })
    },
  })
}

export function useUpdateUserCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserCommandPatch }) =>
      updateUserCommandApi(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commandsKeys.all })
    },
  })
}

export function useDeleteUserCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteUserCommandApi,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commandsKeys.all })
    },
  })
}

export function findEnabledCommandBySlash(
  commands: Array<UserCommandRecord>,
  slash: string,
): UserCommandRecord | null {
  const normalized = slash.trim().toLowerCase()
  return (
    commands.find(
      (command) =>
        command.enabled && command.slash.toLowerCase() === normalized,
    ) ?? null
  )
}

export function expandUserCommandPrompt(
  command: Pick<UserCommandRecord, 'prompt'>,
  input = '',
): string {
  const trimmedInput = input.trim()
  if (command.prompt.includes('{{input}}')) {
    return command.prompt.replaceAll('{{input}}', trimmedInput).trim()
  }
  if (!trimmedInput) return command.prompt.trim()
  return `${command.prompt.trim()}\n\n${trimmedInput}`.trim()
}
