import { useState } from 'react'
import axios from 'axios'
import './FileUpload.css'

function FileUpload({ onUpload, contextLength }) {
  const [file, setFile] = useState(null)
  const [coverImage, setCoverImage] = useState(null)
  const [useCoverFromEpub, setUseCoverFromEpub] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const fetchPreview = async (selectedFile) => {
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('contextLength', contextLength || 200000)
      const res = await axios.post('/api/process/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPreview(res.data)
    } catch (err) {
      setPreviewError(err.response?.data?.error || 'Failed to analyze file')
    } finally {
      setPreviewLoading(false)
    }
  }

  const selectFile = (f) => {
    setFile(f)
    setPreview(null)
    fetchPreview(f)
  }

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.name.endsWith('.epub') || droppedFile.name.endsWith('.mobi')) {
        selectFile(droppedFile)
      }
    }
  }

  const handleSubmit = () => {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    if (coverImage) formData.append('coverImage', coverImage)
    formData.append('useCoverFromEpub', useCoverFromEpub)
    onUpload(formData)
  }

  return (
    <div className="card">
      <h3>Upload Book File</h3>
      <div
        className={`upload-area ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="file-upload"
          accept=".epub,.mobi"
          onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
          style={{ display: 'none' }}
        />
        <label htmlFor="file-upload">
          <div className="upload-content">
            <div className="upload-icon">📖</div>
            {file ? (
              <div className="file-info">
                <p className="file-name">{file.name}</p>
                <p className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            ) : (
              <>
                <p>Drag and drop your book file here</p>
                <p className="preview-label">or click to browse</p>
                <p className="preview-label">DRM-Free .EPUB and .MOBI supported</p>
              </>
            )}
          </div>
        </label>
      </div>

      {file && (
        <>
          {previewLoading && <div className="preview-loading">Analyzing book...</div>}
          {previewError && <div className="preview-error">{previewError}</div>}
          {preview && (
            <div className="preview-stats">
              <div className="preview-grid">
                <div>
                  <span className="preview-label">Text size: </span>
                  <span className="preview-value">{(preview.textLength / 1024).toFixed(0)} KB ({preview.estimatedTokens.toLocaleString()} tokens est.)</span>
                </div>
                <div>
                  <span className="preview-label">Chapters: </span>
                  <span className="preview-value">{preview.chapterCount}</span>
                </div>
                <div>
                  <span className="preview-label">Fits in context: </span>
                  <span className={`preview-value ${preview.fitsInContext ? 'fits' : 'chunked'}`}>
                    {preview.fitsInContext ? 'Yes' : 'No — will be chunked'}
                  </span>
                </div>
                <div>
                  <span className="preview-label">AI requests: </span>
                  <span className="preview-value">
                    {preview.totalRequests}{!preview.fitsInContext && ` (${preview.estimatedChunks} summaries + 1 analysis)`}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="cover-section">
            <label className="cover-section-label">Cover Image Options</label>
            <div className="checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useCoverFromEpub}
                  onChange={(e) => setUseCoverFromEpub(e.target.checked)}
                />
                <span>Extract cover from book file</span>
              </label>
            </div>
            <div className="custom-cover">
              <label className="custom-cover-label">Or upload custom cover image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && setCoverImage(e.target.files[0])}
                disabled={useCoverFromEpub}
              />
              {coverImage && <p className="selected-cover">Selected: {coverImage.name}</p>}
            </div>
          </div>

          <button className="primary-btn process-btn" onClick={handleSubmit}>
            Process Book
          </button>
        </>
      )}
    </div>
  )
}

export default FileUpload
