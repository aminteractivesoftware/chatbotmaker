import { useState } from 'react'
import axios from 'axios'
import './Results.css'

function Results({ data }) {
  const [selectedChar, setSelectedChar] = useState(null)
  const [downloading, setDownloading] = useState(false)

  console.log('=== Results Component Rendered ===')
  console.log('Data received:', data)
  console.log('Component is mounting/updating')

  // Validate data
  if (!data) {
    console.error('Results: No data provided')
    return (
      <div className="error">
        <h3>No data to display</h3>
        <p>The data object is null or undefined</p>
      </div>
    )
  }

  console.log('Data keys:', Object.keys(data))
  console.log('Characters type:', typeof data.characters)
  console.log('Characters value:', data.characters)

  if (!data.characters || !Array.isArray(data.characters)) {
    console.error('Results: Invalid data format - missing characters array')
    console.error('Data structure:', Object.keys(data))
    console.error('Characters:', data.characters)
    return (
      <div className="error">
        <h3>Invalid data format</h3>
        <p>Missing or invalid characters array</p>
        <details>
          <summary>Debug Info</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      </div>
    )
  }

  if (!data.lorebook || !data.lorebook.entries) {
    console.error('Results: Invalid data format - missing lorebook data')
    return (
      <div className="error">
        <h3>Invalid data format</h3>
        <p>Missing lorebook data</p>
        <details>
          <summary>Debug Info</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      </div>
    )
  }
  
  console.log(`\u2713 Results component validated: ${data.characters.length} characters, ${data.lorebook.entries.length} lorebook entries`)
  console.log('About to render Results UI...')

  const downloadJSON = (jsonData, filename) => {
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadCharacterPNG = async (char) => {
    try {
      setDownloading(true)
      const response = await axios.post('/api/export/character/png', {
        characterData: char,
        coverImage: data.coverImage
      }, {
        responseType: 'blob'
      })

      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${char.data.name.replace(/[^a-z0-9]/gi, '_')}.png`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error downloading PNG:', error)
      alert('Failed to download PNG: ' + error.message)
    } finally {
      setDownloading(false)
    }
  }

  const downloadAllCharactersJSON = () => {
    data.characters.forEach(char => {
      downloadJSON(char, `${char.data.name.replace(/[^a-z0-9]/gi, '_')}.json`)
    })
  }

  const downloadAllCharactersPNG = async () => {
    for (const char of data.characters) {
      await downloadCharacterPNG(char)
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  const downloadLorebook = () => {
    downloadJSON(data.lorebook, `${data.bookTitle?.replace(/[^a-z0-9]/gi, '_') || 'lorebook'}_lorebook.json`)
  }

  return (
    <div className="results">
      <div className="success">
        ✅ Successfully generated {data.characters.length} character card(s) and lorebook!
      </div>

      <div className="card">
        <h2>📖 {data.bookTitle || 'Your Book'}</h2>

        <div className="download-section">
          <h3>Download All</h3>
          <div className="download-buttons">
            <button
              className="primary-btn"
              onClick={downloadAllCharactersJSON}
              disabled={downloading}
            >
              📄 All Characters JSON ({data.characters.length})
            </button>
            <button
              className="primary-btn"
              onClick={downloadAllCharactersPNG}
              disabled={downloading}
            >
              🖼️ All Characters PNG ({data.characters.length})
            </button>
            <button
              className="secondary-btn"
              onClick={downloadLorebook}
              disabled={downloading}
            >
              📚 Lorebook JSON
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Characters ({data.characters.length})</h3>
        <div className="character-grid">
          {data.characters.map((char, idx) => (
            <div
              key={idx}
              className="character-card"
              onClick={() => setSelectedChar(selectedChar === idx ? null : idx)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                <h4>{char.data.name}</h4>
                <span style={{ 
                  fontSize: '12px', 
                  padding: '4px 8px', 
                  borderRadius: '4px', 
                  background: char.isPersona ? 'var(--primary-orange)' : 'var(--sepia-dark)',
                  whiteSpace: 'nowrap',
                  marginLeft: '8px'
                }}>
                  {char.characterType || 'Character'}
                </span>
              </div>
              <p className="char-preview">
                {char.data.description?.substring(0, 150)}...
              </p>
              {char.canBePersona && !char.isPersona && (
                <p style={{ fontSize: '12px', color: 'var(--primary-orange)', marginTop: '8px' }}>
                  ✨ Persona version available
                </p>
              )}
              {char.data.alternate_greetings && char.data.alternate_greetings.length > 0 && (
                <p style={{ fontSize: '12px', color: 'var(--secondary-text)', marginTop: '4px' }}>
                  💬 {char.data.alternate_greetings.length + 1} first message options
                </p>
              )}
              {char.data.tags && char.data.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                  {char.data.tags.slice(0, 5).map((tag, tagIdx) => (
                    <span
                      key={tagIdx}
                      style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        background: '#2C2C2C',
                        color: 'var(--secondary-text)'
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                  {char.data.tags.length > 5 && (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        color: 'var(--secondary-text)'
                      }}
                    >
                      +{char.data.tags.length - 5} more
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  className="secondary-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadJSON(char, `${char.data.name.replace(/[^a-z0-9]/gi, '_')}.json`)
                  }}
                  disabled={downloading}
                  style={{ flex: 1, fontSize: '14px', padding: '8px' }}
                >
                  📄 JSON
                </button>
                <button
                  className="primary-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadCharacterPNG(char)
                  }}
                  disabled={downloading}
                  style={{ flex: 1, fontSize: '14px', padding: '8px' }}
                >
                  🖼️ PNG
                </button>
              </div>
              {selectedChar === idx && (
                <div className="char-details">
                  <div className="detail-section">
                    <strong>Type:</strong>
                    <p>{char.characterType || 'Character'} {char.isPersona ? '(Roleplay AS this character)' : '(Interact WITH this character)'}</p>
                  </div>
                  {char.data.tags && char.data.tags.length > 0 && (
                    <div className="detail-section">
                      <strong>Tags:</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                        {char.data.tags.map((tag, tagIdx) => (
                          <span
                            key={tagIdx}
                            style={{
                              fontSize: '12px',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              background: '#2C2C2C',
                              color: 'var(--text-light)',
                              border: '1px solid #3C3C3C'
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="detail-section">
                    <strong>Description:</strong>
                    <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '14px' }}>{char.data.description}</pre>
                  </div>
                  <div className="detail-section">
                    <strong>First Message:</strong>
                    <p>{char.data.first_mes}</p>
                    {char.data.alternate_greetings && char.data.alternate_greetings.length > 0 && (
                      <>
                        <p style={{ marginTop: '10px', color: 'var(--secondary-text)', fontSize: '14px' }}>
                          <strong>Alternate First Messages:</strong>
                        </p>
                        {char.data.alternate_greetings.map((greeting, gIdx) => (
                          <p key={gIdx} style={{ marginTop: '8px', paddingLeft: '10px', borderLeft: '2px solid var(--sepia-dark)' }}>
                            {greeting}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Lorebook Entries ({data.lorebook.entries.length})</h3>
        <div className="lorebook-entries">
          {data.lorebook.entries.slice(0, 10).map((entry, idx) => (
            <div key={idx} className="lorebook-entry">
              <strong>{entry.name}</strong>
              <p className="entry-keys">Keys: {entry.keys.join(', ')}</p>
              <p>{entry.content ? entry.content.substring(0, 150) : 'No content available'}...</p>
            </div>
          ))}
          {data.lorebook.entries.length > 10 && (
            <p style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>
              ...and {data.lorebook.entries.length - 10} more entries
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>How to Use</h3>
        <ol>
          <li>Download the character cards and lorebook files</li>
          <li>Import the JSON files into your chatbot application</li>
          <li><strong>Regular character cards:</strong> Use these to chat WITH the character (you interact with them)</li>
          <li><strong>Persona cards:</strong> Use these to roleplay AS the character (you become them). These are marked with "(Persona)" in the name</li>
          <li><strong>{'{{'}user{'}}'} placeholder:</strong> Character names are replaced with {'{{'}user{'}}'} in scenarios, first messages, and dialogue. This means you automatically take the role of whoever that character interacts with (main character, love interest, etc.) for a more immersive experience</li>
          <li>Character types are labeled: Main Character, Love Interest, Antagonist, etc.</li>
          <li><strong>Tags:</strong> Each character has 5-15 auto-generated tags (gender, species, personality traits, genre, etc.) compatible with chub.ai</li>
          <li><strong>Multiple first messages:</strong> Each character has 3 alternative first message options. The primary one is used by default, and alternates are stored in the card's alternate_greetings field</li>
          <li><strong>Scenario:</strong> Describes the context of when the character first meets {'{{'}user{'}}'}</li>
          <li>Lorebooks contain world information and context that enriches conversations</li>
          <li>Descriptions include structured sections: Background, Physical Description, Personality Traits, Scenario, Common Phrases, First Message Options, and Example Text</li>
          <li>Content may include mature language where appropriate to the source material</li>
        </ol>
      </div>
    </div>
  )
}

export default Results
