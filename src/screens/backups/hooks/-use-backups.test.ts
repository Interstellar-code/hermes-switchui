// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBackupList, useCreateBackup, useRestoreBackup, useRestoreUpload } from './use-backups'

// Mock toast
vi.mock('@/components/ui/toast', () => ({
  toast: vi.fn(),
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  return function QueryClientWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useBackupList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns {backups: [], pending: true} when fetch returns {ok: false, pending: true}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, pending: true, backups: [] }),
    })

    const { result } = renderHook(() => useBackupList(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ backups: [], pending: true })
    expect(mockFetch).toHaveBeenCalledWith('/api/backups/list')
  })

  it('returns {backups: [], pending: true} when fetch returns {ok: false} without pending flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false }),
    })

    const { result } = renderHook(() => useBackupList(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ backups: [], pending: true })
  })

  it('maps backend {name, path, size, modified} to {name, archive, size, mtime, mtime_iso}', async () => {
    const mockBackupsRaw = [
      { name: 'backup1.zip', path: '/path/backup1.zip', size: 1024, modified: '2026-05-17T00:00:00Z' },
      { name: 'backup2.zip', path: '/path/backup2.zip', size: 2048, modified: '2026-05-17T00:01:40Z' },
    ]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backups: mockBackupsRaw }),
    })

    const { result } = renderHook(() => useBackupList(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ backups: expect.any(Array), pending: false })
    expect(result.current.data.backups).toHaveLength(2)
    expect(result.current.data.backups[0]).toEqual({
      name: 'backup1.zip',
      archive: '/path/backup1.zip',
      size: 1024,
      mtime: expect.any(Number),
      mtime_iso: '2026-05-17T00:00:00Z',
    })
  })

  it('returns {backups: [], pending: false} when backend returns empty list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backups: [] }),
    })

    const { result } = renderHook(() => useBackupList(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ backups: [], pending: false })
  })

  it('handles JSON parse errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON')
      },
    })

    const { result } = renderHook(() => useBackupList(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ backups: [], pending: true })
  })
})

describe('useCreateBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls POST /api/backups/create with correct body when output is provided', async () => {
    const mockResponse = { ok: true, pid: 12345, name: 'hermes-backup.zip', archive: '/path/backup.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useCreateBackup(), { wrapper: createWrapper() })

    await result.current.mutateAsync({ output: '/path/to/backup.zip' })

    expect(mockFetch).toHaveBeenCalledWith('/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '/path/to/backup.zip' }),
    })
  })

  it('calls POST /api/backups/create with empty body when no output is provided', async () => {
    const mockResponse = { ok: true, pid: 67890, name: 'default-backup.zip', archive: '/default.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useCreateBackup(), { wrapper: createWrapper() })

    await result.current.mutateAsync()

    expect(mockFetch).toHaveBeenCalledWith('/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  })

  it('throws error when upstream returns ok: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'Backup creation failed' }),
    })

    const { result } = renderHook(() => useCreateBackup(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync()).rejects.toThrow('Backup creation failed')
  })

  it('throws error when upstream returns non-200 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })

    const { result } = renderHook(() => useCreateBackup(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync()).rejects.toThrow('Internal server error')
  })

  it('returns upstream response on success', async () => {
    const mockResponse = { ok: true, pid: 12345, name: 'test-backup.zip', archive: '/test.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useCreateBackup(), { wrapper: createWrapper() })

    const response = await result.current.mutateAsync()

    expect(response).toEqual(mockResponse)
  })
})

describe('useRestoreBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls POST /api/backups/restore with {archive} (NOT {archive, force})', async () => {
    const mockResponse = { ok: true, pid: 54321, archive: '/restored/backup.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useRestoreBackup(), { wrapper: createWrapper() })

    await result.current.mutateAsync({ archive: '/path/to/backup.zip' })

    expect(mockFetch).toHaveBeenCalledWith('/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip' }),
    })
  })

  it('does NOT send force parameter in request body', async () => {
    const mockResponse = { ok: true, pid: 54321, archive: '/restored/backup.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useRestoreBackup(), { wrapper: createWrapper() })

    await result.current.mutateAsync({ archive: '/path/to/backup.zip' })

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(requestBody).toEqual({ archive: '/path/to/backup.zip' })
    expect(requestBody).not.toHaveProperty('force')
  })

  it('throws error when upstream returns ok: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'Restore failed' }),
    })

    const { result } = renderHook(() => useRestoreBackup(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync({ archive: '/path/to/backup.zip' })).rejects.toThrow('Restore failed')
  })

  it('throws error when upstream returns non-200 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Backup not found' }),
    })

    const { result } = renderHook(() => useRestoreBackup(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync({ archive: '/path/to/backup.zip' })).rejects.toThrow('Backup not found')
  })

  it('returns upstream response on success', async () => {
    const mockResponse = { ok: true, pid: 99999, archive: '/restored/test.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const { result } = renderHook(() => useRestoreBackup(), { wrapper: createWrapper() })

    const response = await result.current.mutateAsync({ archive: '/path/to/backup.zip' })

    expect(response).toEqual(mockResponse)
  })
})

describe('useRestoreUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends FormData without manually setting content-type header', async () => {
    const mockResponse = { ok: true, pid: 11111, archive: '/restored/upload.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const mockFile = new File(['test content'], 'test-backup.zip', { type: 'application/zip' })
    const { result } = renderHook(() => useRestoreUpload(), { wrapper: createWrapper() })

    await result.current.mutateAsync({ file: mockFile })

    expect(mockFetch).toHaveBeenCalledWith('/api/backups/restore-upload', {
      method: 'POST',
      body: expect.any(FormData),
    })

    // Verify content-type is NOT set manually
    expect(mockFetch.mock.calls[0][1].headers).toBeUndefined()

    // Verify the FormData contains the file
    const formData = mockFetch.mock.calls[0][1].body
    expect(formData instanceof FormData).toBe(true)
  })

  it('throws error when upstream returns ok: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'Upload restore failed' }),
    })

    const mockFile = new File(['test content'], 'test-backup.zip', { type: 'application/zip' })
    const { result } = renderHook(() => useRestoreUpload(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync({ file: mockFile })).rejects.toThrow('Upload restore failed')
  })

  it('throws error when upstream returns non-200 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })

    const mockFile = new File(['test content'], 'test-backup.zip', { type: 'application/zip' })
    const { result } = renderHook(() => useRestoreUpload(), { wrapper: createWrapper() })

    await expect(result.current.mutateAsync({ file: mockFile })).rejects.toThrow('Internal server error')
  })

  it('returns upstream response on success', async () => {
    const mockResponse = { ok: true, pid: 22222, archive: '/restored/uploaded.zip' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const mockFile = new File(['test content'], 'test-backup.zip', { type: 'application/zip' })
    const { result } = renderHook(() => useRestoreUpload(), { wrapper: createWrapper() })

    const response = await result.current.mutateAsync({ file: mockFile })

    expect(response).toEqual(mockResponse)
  })
})
