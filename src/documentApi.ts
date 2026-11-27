import { apiUrl } from './api'

export type DocumentFile = {
  id: string
  fileName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseDocuments(value: unknown): DocumentFile[] {
  if (!Array.isArray(value)) {
    throw new Error('The documents endpoint returned an invalid response.')
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error('The documents endpoint returned an invalid document.')
    }

    const rawId = item.documentId ?? item.id
    const fileName = item.fileName
    if (
      (typeof rawId !== 'string' && typeof rawId !== 'number') ||
      typeof fileName !== 'string'
    ) {
      throw new Error('The documents endpoint returned an invalid document.')
    }

    return { id: String(rawId), fileName }
  })
}

export async function fetchDocuments(
  signal?: AbortSignal,
): Promise<DocumentFile[]> {
  const response = await fetch(apiUrl('/api/Documents/ListDocuments'), {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Could not load documents (HTTP ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('The documents endpoint returned invalid JSON.')
  }

  return parseDocuments(data)
}
