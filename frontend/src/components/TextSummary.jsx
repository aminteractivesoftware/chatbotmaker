import { useState } from 'react'
import './TextSummary.css'

function TextSummary({ onSubmit }) {
  const [text, setText] = useState('')
  const [coverImage, setCoverImage] = useState(null)
  const [webUrl, setWebUrl] = useState('')
  const [useCoverFromWeb, setUseCoverFromWeb] = useState(false)
  const [urlError, setUrlError] = useState('')

  const isValidUrl = (url) => {
    if (!url) return true // Empty is okay
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname.toLowerCase()
      return hostname.includes('goodreads.com') || hostname.includes('amazon.com') || hostname.includes('amazon.')
    } catch {
      return false
    }
  }

  const handleUrlChange = (e) => {
    const url = e.target.value
    setWebUrl(url)

    if (url && !isValidUrl(url)) {
      setUrlError('Only Goodreads and Amazon URLs are supported')
      setUseCoverFromWeb(false)
    } else {
      setUrlError('')
      // Auto-check cover extraction if valid URL is entered
      if (url && isValidUrl(url)) {
        setUseCoverFromWeb(true)
      }
    }
  }

  const handleCoverChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCoverImage(e.target.files[0])
    }
  }

  const handleSubmit = () => {
    if (text.trim() && !urlError) {
      const formData = new FormData()
      formData.append('summary', text)
      if (coverImage) formData.append('coverImage', coverImage)
      if (webUrl && isValidUrl(webUrl)) formData.append('webUrl', webUrl)
      formData.append('useCoverFromWeb', useCoverFromWeb)
      onSubmit(formData)
    }
  }

  return (
    <div className="card">
      <h3>Paste Book Summary</h3>
      <p style={{ color: 'var(--secondary-text)', marginBottom: '15px' }}>
        Paste a detailed summary of your book, including information about characters, plot, and world.
      </p>
      <textarea
        placeholder="Paste your book summary here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={15}
      />

      <div style={{ marginTop: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-light)' }}>
          Book URL (optional - Goodreads or Amazon only)
        </label>
        <input
          type="text"
          placeholder="https://www.goodreads.com/book/show/..."
          value={webUrl}
          onChange={handleUrlChange}
          style={{
            borderColor: urlError ? '#dc3545' : undefined
          }}
        />
        {urlError && (
          <small style={{ display: 'block', color: '#dc3545', marginTop: '5px' }}>
            {urlError}
          </small>
        )}
      </div>

      <div style={{ marginTop: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-light)' }}>
          Cover Image Options
        </label>

        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useCoverFromWeb}
              onChange={(e) => setUseCoverFromWeb(e.target.checked)}
              disabled={!webUrl}
              style={{ marginRight: '10px' }}
            />
            <span>Extract cover from website URL</span>
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
            disabled={useCoverFromWeb}
          />
          {coverImage && (
            <p style={{ marginTop: '5px', color: 'var(--primary-orange)' }}>
              Selected: {coverImage.name}
            </p>
          )}
        </div>
      </div>

      <button
        className="primary-btn"
        onClick={handleSubmit}
        disabled={!text.trim()}
        style={{ marginTop: '20px', width: '100%' }}
      >
        Process Summary
      </button>
    </div>
  )
}

export default TextSummary
