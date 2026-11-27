import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiUrl } from './api'
import { fetchDocuments, type DocumentFile } from './documentApi'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]

async function validatePdf(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Choose a PDF file.')
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('The PDF must be 20 MB or smaller.')
  }

  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const hasPdfSignature = header.some((_, index) =>
    PDF_SIGNATURE.every((byte, offset) => header[index + offset] === byte),
  )

  if (!hasPdfSignature) {
    throw new Error('The selected file does not appear to be a valid PDF.')
  }
}

function Documents() {
  const [documents, setDocuments] = useState<DocumentFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DocumentFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function refreshDocuments() {
    setIsLoading(true)
    setError(null)
    try {
      setDocuments(await fetchDocuments())
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not load documents.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true

    fetchDocuments()
      .then((items) => {
        if (isCurrent) {
          setDocuments(items)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setError(
            error instanceof Error ? error.message : 'Could not load documents.',
          )
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFile || isUploading) {
      return
    }

    setError(null)
    setNotice(null)
    setIsUploading(true)

    try {
      await validatePdf(selectedFile)

      const formData = new FormData()
      formData.append('file', selectedFile)
      const response = await fetch(apiUrl('/api/Documents/Upload'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Could not upload the PDF (HTTP ${response.status}).`)
      }

      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setNotice('PDF uploaded successfully.')
      await refreshDocuments()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not upload PDF.')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete || deletingId) {
      return
    }

    const document = pendingDelete
    setDeletingId(document.id)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(
        apiUrl(`/api/Documents/${encodeURIComponent(document.id)}/Delete`),
        { method: 'DELETE' },
      )

      if (!response.ok) {
        throw new Error(`Could not delete the document (HTTP ${response.status}).`)
      }

      setPendingDelete(null)
      setNotice(`${document.fileName} was deleted.`)
      await refreshDocuments()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not delete document.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <a className="chat-brand" href="/">
          <span className="chat-brand-mark" aria-hidden="true">
            D
          </span>
          Documents
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="documents-content" aria-label="Manage documents">
        <header className="documents-heading">
          <p className="eyebrow">KNOWLEDGE BASE</p>
          <h1>Documents</h1>
          <p>Upload PDFs for your document chats.</p>
        </header>

        <form className="upload-panel" onSubmit={handleUpload}>
          <label htmlFor="pdf-file">Choose a PDF to upload</label>
          <p className="upload-help">PDF only · Maximum file size 20 MB</p>
          <div className="upload-controls">
            <input
              ref={fileInputRef}
              id="pdf-file"
              name="file"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null)
                setError(null)
                setNotice(null)
              }}
              disabled={isUploading}
            />
            <button type="submit" disabled={!selectedFile || isUploading}>
              {isUploading ? 'Uploading…' : 'Upload PDF'}
            </button>
          </div>
          {selectedFile && (
            <p className="selected-file">
              {selectedFile.name} · {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
        </form>

        {error && (
          <p className="documents-message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="documents-message success" role="status">
            {notice}
          </p>
        )}

        <section className="document-list" aria-labelledby="document-list-heading">
          <div className="document-list-heading">
            <h2 id="document-list-heading">Uploaded PDFs</h2>
            <button
              className="refresh-documents"
              type="button"
              onClick={() => void refreshDocuments()}
              disabled={isLoading || isUploading || deletingId !== null}
            >
              Refresh
            </button>
          </div>

          {isLoading && documents.length === 0 && (
            <p className="document-empty" role="status">
              Loading documents…
            </p>
          )}

          {!isLoading && !error && documents.length === 0 && (
            <p className="document-empty">No documents uploaded yet.</p>
          )}

          {documents.length > 0 && (
            <ul className="document-items">
              {documents.map((document) => (
                <li className="document-item" key={document.id}>
                  <div className="document-details">
                    <span className="pdf-badge" aria-hidden="true">
                      PDF
                    </span>
                    <div>
                      <p className="document-name">{document.fileName}</p>
                      <p className="document-id">ID: {document.id}</p>
                    </div>
                  </div>
                  <button
                    className="delete-document-button"
                    type="button"
                    onClick={() => setPendingDelete(document)}
                    disabled={deletingId !== null}
                    aria-label={`Delete ${document.fileName}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {pendingDelete && (
        <div className="confirmation-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
          >
            <h2 id="delete-dialog-title">Delete document?</h2>
            <p id="delete-dialog-description">
              This will permanently delete <strong>{pendingDelete.fileName}</strong>.
              Are you sure?
            </p>
            {error && (
              <p className="documents-message error" role="alert">
                {error}
              </p>
            )}
            <div className="confirmation-actions">
              <button
                type="button"
                className="cancel-delete-button"
                onClick={() => {
                  setPendingDelete(null)
                  setError(null)
                }}
                disabled={deletingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-delete-button"
                onClick={() => void handleDelete()}
                disabled={deletingId !== null}
              >
                {deletingId ? 'Deleting…' : 'Delete document'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default Documents
