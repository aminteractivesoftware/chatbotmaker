import { useState } from 'react'
import './TextSummary.css'

function TextSummary({ onSubmit }) {
  const [text, setText] = useState('')
  const [coverImage, setCoverImage] = useState(null)
  const [webUrl, setWebUrl] = useState('')
  const [useCoverFromWeb, setUseCoverFromWeb] = useState(false)
  const [urlError, setUrlError] = useState('')

  const isValidUrl = (url) => {
    if (!url) return true
    try {
      const hostname = new URL(url).hostname.toLowerCase()
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
      if (url && isValidUrl(url)) setUseCoverFromWeb(true)
    }
  }

  const handleSubmit = () => {
    if (!text.trim() || urlError) return
    const formData = new FormData()
    formData.append('summary', text)
    if (coverImage) formData.append('coverImage', coverImage)
    if (webUrl && isValidUrl(webUrl)) formData.append('webUrl', webUrl)
    formData.append('useCoverFromWeb', useCoverFromWeb)
    onSubmit(formData)
  }

  return (
    <div className="card">
      <h3>Paste Book Summary</h3>
      <p className="summary-hint">
        Paste a detailed summary of your book, including information about characters, plot, and world.
      </p>
      <textarea
        placeholder="Paste your book summary here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={15}
      />

      <div className="url-section">
        <label className="url-section-label">Book URL (optional - Goodreads or Amazon only)</label>
        <input
          type="text"
          placeholder="https://www.goodreads.com/book/show/..."
          value={webUrl}
          onChange={handleUrlChange}
          className={urlError ? 'url-input-error' : ''}
        />
        {urlError && <small className="url-error-text">{urlError}</small>}
      </div>

      <div className="cover-section">
        <label className="cover-section-label">Cover Image Options</label>
        <div className="checkbox-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useCoverFromWeb}
              onChange={(e) => setUseCoverFromWeb(e.target.checked)}
              disabled={!webUrl}
            />
            <span>Extract cover from website URL</span>
          </label>
        </div>
        <div className="custom-cover">
          <label className="custom-cover-label">Or upload custom cover image</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && setCoverImage(e.target.files[0])}
            disabled={useCoverFromWeb}
          />
          {coverImage && <p className="selected-cover">Selected: {coverImage.name}</p>}
        </div>
      </div>

      <button className="primary-btn process-btn" onClick={handleSubmit} disabled={!text.trim()}>
        Process Summary
      </button>
    </div>
  )
}

export default TextSummary
