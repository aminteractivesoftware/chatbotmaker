import { useState, useEffect } from 'react'
import axios from 'axios'
import FileUpload from './components/FileUpload'
import TextSummary from './components/TextSummary'
import Results from './components/Results'
import ModelSelector from './components/ModelSelector'
import './App.css'

function App() {
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('openrouter_api_key') || ''
  })
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [selectedModel, setSelectedModel] = useState('google/gemini-flash-1.5-8b')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)
  const [mode, setMode] = useState('file') // 'file' or 'summary'
  const [progressMessage, setProgressMessage] = useState('')

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('openrouter_api_key', apiKey)
      setApiKeySaved(true)
      setTimeout(() => setApiKeySaved(false), 2000)
    }
  }

  // Fetch available models when API key is entered
  useEffect(() => {
    const fetchModels = async () => {
      if (!apiKey.trim()) {
        setModels([])
        return
      }

      setLoadingModels(true)
      try {
        const response = await axios.get('/api/process/models', {
          headers: { 'x-api-key': apiKey }
        })
        // Sort models: free models first, then by context length
        const sortedModels = response.data.models.sort((a, b) => {
          const aFree = (a.pricing?.prompt === '0' || a.pricing?.prompt === 0 || a.id.includes(':free')) && 
                        (a.pricing?.completion === '0' || a.pricing?.completion === 0 || a.id.includes(':free'))
          const bFree = (b.pricing?.prompt === '0' || b.pricing?.prompt === 0 || b.id.includes(':free')) && 
                        (b.pricing?.completion === '0' || b.pricing?.completion === 0 || b.id.includes(':free'))
          if (aFree && !bFree) return -1
          if (!aFree && bFree) return 1
          return (b.context_length || 0) - (a.context_length || 0)
        })
        setModels(sortedModels)
        // Auto-select first free model if current selection is not free
        const firstFreeModel = sortedModels.find(m => 
          ((m.pricing?.prompt === '0' || m.pricing?.prompt === 0) && 
           (m.pricing?.completion === '0' || m.pricing?.completion === 0)) || 
          m.id.includes(':free')
        )
        if (firstFreeModel) {
          setSelectedModel(firstFreeModel.id)
        }
      } catch (err) {
        console.error('Failed to load models:', err)
        // Use default models if API call fails
        setModels([
          { id: 'google/gemini-flash-1.5-8b', name: 'Gemini Flash 1.5 8B (Free)', context_length: 1000000 },
          { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (Free)', context_length: 131072 },
          { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', context_length: 1000000 },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000 },
          { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', context_length: 128000 },
        ])
      } finally {
        setLoadingModels(false)
      }
    }

    const debounce = setTimeout(fetchModels, 500)
    return () => clearTimeout(debounce)
  }, [apiKey])

  // Debug effect to track results state changes
  useEffect(() => {
    console.log('=== RESULTS STATE CHANGED ===')
    console.log('Loading:', loading)
    console.log('Error:', error)
    console.log('Results:', results ? `Object with ${results.characters?.length} characters` : 'null')
    if (results) {
      console.log('Results details:', {
        charactersCount: results.characters?.length,
        lorebookEntries: results.lorebook?.entries?.length,
        bookTitle: results.bookTitle
      })
    }
  }, [results, loading, error])

  const handleProcess = async (formData) => {
    if (!apiKey.trim()) {
      setError('Please enter your OpenRouter API key')
      return
    }

    setLoading(true)
    setError('')
    setResults(null)
    setProgressMessage('Uploading file...')

    try {
      formData.append('apiKey', apiKey)
      formData.append('model', selectedModel)

      // Get context length for selected model
      const selectedModelData = models.find(m => m.id === selectedModel)
      const contextLength = selectedModelData?.context_length || 200000
      formData.append('contextLength', contextLength)

      const endpoint = mode === 'file' ? '/api/process/file' : '/api/process/summary'
      
      // Generate a unique sessionId for progress tracking
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      formData.append('sessionId', sessionId);
      
      console.log('Sending request to:', endpoint, 'with sessionId:', sessionId)
      setProgressMessage('Uploading file...')
      
      // Progress polling state
      let progressInterval = null;
      
      const startProgressPolling = () => {
        console.log('Starting progress polling for session:', sessionId);
        let lastMessage = '';
        progressInterval = setInterval(async () => {
          try {
            const progressRes = await axios.get(`/api/process/progress/${sessionId}`);
            if (progressRes.data && progressRes.data.message) {
              // Only log if message changed to reduce console spam
              if (progressRes.data.message !== lastMessage) {
                console.log('Progress update:', progressRes.data.message);
                lastMessage = progressRes.data.message;
                setProgressMessage(progressRes.data.message);
              }
            }
          } catch (err) {
            // Silently fail - progress polling is optional
          }
        }, 2000); // Poll every 2 seconds (reduced from 500ms to avoid overwhelming)
      };
      
      const stopProgressPolling = () => {
        if (progressInterval) {
          console.log('Stopping progress polling');
          clearInterval(progressInterval);
          progressInterval = null;
        }
      };
      
      const response = await axios.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000, // 5 minute timeout
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          setProgressMessage(`Uploading file... ${percentCompleted}%`)
          
          // When upload completes, start polling backend progress
          if (percentCompleted === 100 && !progressInterval) {
            setProgressMessage('Upload complete. Processing book...');
            startProgressPolling();
          }
        }
      })

      // Stop progress polling once we have the response
      stopProgressPolling();

      console.log('Response received:', response.data)
      
      // Validate response
      if (!response.data) {
        console.error('ERROR: No data received from server')
        throw new Error('No data received from server')
      }
      
      console.log('Response has data. Checking structure...')
      console.log('Characters:', response.data.characters)
      console.log('Lorebook:', response.data.lorebook)
      
      if (!response.data.characters || !Array.isArray(response.data.characters)) {
        console.error('ERROR: Invalid response structure:', response.data)
        console.error('Characters is:', typeof response.data.characters, response.data.characters)
        throw new Error('Invalid response format: missing characters array')
      }
      
      console.log(`✓ Valid response with ${response.data.characters.length} characters`)
      setProgressMessage('Processing complete! Loading results...')
      
      console.log('Setting results state...')
      setResults(response.data)
      setLoading(false) // Explicitly set loading to false
      
      // Force a small delay to ensure state updates
      await new Promise(resolve => setTimeout(resolve, 100))
      
      console.log('Results set successfully:', response.data.characters.length, 'characters')
    } catch (err) {
      console.error('Processing error:', err)
      console.error('Error details:', err.response?.data)
      const errorMessage = err.response?.data?.error || err.message || 'An error occurred'
      setError(errorMessage)
      alert('Error: ' + errorMessage)
      setLoading(false)
    } finally {
      // Don't set loading here since we do it above
      setProgressMessage('')
    }
  }

  return (
    <div className="container">
      <header>
        <h1>📚 Chatbot Maker</h1>
        <p>Generate character cards and lorebooks from books</p>
      </header>

      <div className="card">
        <h3>OpenRouter Configuration</h3>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-light)' }}>
            API Key {localStorage.getItem('openrouter_api_key') && <span style={{ color: 'var(--primary-orange)', fontSize: '12px' }}>✓ Saved in cache</span>}
          </label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="password"
              placeholder="Enter your OpenRouter API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim()}
              className={apiKeySaved ? 'primary-btn' : 'secondary-btn'}
              style={{
                padding: '12px 20px',
                whiteSpace: 'nowrap',
                minWidth: '120px',
                background: apiKeySaved ? '#28a745' : undefined
              }}
            >
              {apiKeySaved ? '✓ Saved!' : '💾 Save Key'}
            </button>
          </div>
          <small>
            Get your API key from{' '}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
              openrouter.ai
            </a>
          </small>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-light)' }}>
            Model
          </label>

          {loadingModels ? (
            <div style={{
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #2C2C2C',
              background: 'var(--surface-dark)',
              color: 'var(--secondary-text)',
              textAlign: 'center'
            }}>
              Loading models...
            </div>
          ) : models.length > 0 ? (
            <>
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                disabled={!apiKey.trim()}
              />
              {models.find(m => m.id === selectedModel) && (
                <small style={{ display: 'block', marginTop: '5px' }}>
                  Context window: {(models.find(m => m.id === selectedModel)?.context_length / 1000).toFixed(0)}K tokens
                  {' '}- Large books will be automatically chunked
                </small>
              )}
            </>
          ) : (
            <div style={{
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #2C2C2C',
              background: 'var(--surface-dark)',
              color: 'var(--secondary-text)',
              textAlign: 'center'
            }}>
              Enter API key to load models
            </div>
          )}
        </div>
      </div>

      <div className="card mode-selector">
        <button
          className={mode === 'file' ? 'primary-btn active' : 'secondary-btn'}
          onClick={() => setMode('file')}
        >
          Upload Book
        </button>
        <button
          className={mode === 'summary' ? 'primary-btn active' : 'secondary-btn'}
          onClick={() => setMode('summary')}
          style={{ marginLeft: '10px' }}
        >
          Paste Summary
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>{progressMessage || 'Processing... This may take a few minutes depending on book size.'}</p>
          <small style={{ color: 'var(--secondary-text)', marginTop: '10px' }}>Please keep this tab open</small>
        </div>
      )}

      {!loading && results && (
        <div key={results.sessionId || 'results'}>
          <div style={{ padding: '10px', background: '#2C2C2C', marginBottom: '10px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <small style={{ color: 'var(--primary-orange)' }}>✓ Results loaded - displaying {results.characters?.length || 0} characters</small>
            <button 
              className="secondary-btn" 
              onClick={() => {
                setResults(null)
                setError('')
                console.log('Results cleared, ready for new upload')
              }}
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              📤 New Upload
            </button>
          </div>
          <Results data={results} />
        </div>
      )}

      {!loading && !results && !error && (
        <>
          {mode === 'file' ? (
            <FileUpload onUpload={handleProcess} />
          ) : (
            <TextSummary onSubmit={handleProcess} />
          )}
          <div style={{ color: 'var(--secondary-text)', textAlign: 'center', marginTop: '20px' }}>
            <small>Ready to process your book</small>
          </div>
        </>
      )}
    </div>
  )
}

export default App
