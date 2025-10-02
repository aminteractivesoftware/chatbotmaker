import { useState } from 'react'
import './FileUpload.css'

function FileUpload({ onUpload }) {
  const [file, setFile] = useState(null)
  const [coverImage, setCoverImage] = useState(null)
  const [useCoverFromEpub, setUseCoverFromEpub] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.name.endsWith('.epub') || droppedFile.name.endsWith('.mobi')) {
        setFile(droppedFile)
      } else {
        alert('Please upload an EPUB or MOBI file')
      }
    }
  }

  const handleChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleCoverChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCoverImage(e.target.files[0])
    }
  }

  const handleSubmit = () => {
    if (file) {
      const formData = new FormData()
      formData.append('file', file)
      if (coverImage) formData.append('coverImage', coverImage)
      formData.append('useCoverFromEpub', useCoverFromEpub)
      onUpload(formData)
    }
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
          onChange={handleChange}
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
                <p style={{ color: 'var(--secondary-text)' }}>or click to browse</p>
                <p style={{ color: 'var(--secondary-text)', fontSize: '0.9em', marginTop: '8px' }}>DRM-Free .EPUB and .MOBI supported</p>
              </>
            )}
          </div>
        </label>
      </div>

      {file && (
        <>
          <div style={{ marginTop: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-light)' }}>
              Cover Image Options
            </label>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useCoverFromEpub}
                  onChange={(e) => setUseCoverFromEpub(e.target.checked)}
                  style={{ marginRight: '10px' }}
                />
                <span>Extract cover from book file</span>
              </label>
            </div>

            <div style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-light)' }}>
                Or upload custom cover image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverChange}
                disabled={useCoverFromEpub}
              />
              {coverImage && (
                <p style={{ marginTop: '5px', color: 'var(--primary-orange)' }}>
                  Selected: {coverImage.name}
                </p>
              )}
            </div>
          </div>

          <button className="primary-btn" onClick={handleSubmit} style={{ marginTop: '20px', width: '100%' }}>
            Process Book
          </button>
        </>
      )}
    </div>
  )
}

export default FileUpload
