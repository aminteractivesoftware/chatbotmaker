import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import FileUpload from './components/FileUpload'
import TextSummary from './components/TextSummary'
import Results from './components/Results'
import ModelSelector from './components/ModelSelector'
import ErrorBoundary from './components/ErrorBoundary'
import useProgressPolling from './hooks/useProgressPolling'
import { isModelFree } from './utils/modelUtils'
import './App.css'

const MODEL_FETCH_DEBOUNCE_MS = 500
const CONFIG_SAVED_FLASH_MS = 2000
const TEST_STATUS_FLASH_MS = 5000
const FETCH_ERROR_FLASH_MS = 5000
const REQUEST_TIMEOUT_MS = 300000
const DEFAULT_CONTEXT_LENGTH = 200000

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    return localStorage.getItem('ai_api_base_url') || 'https://openrouter.ai/api/v1'
  })
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('ai_api_key') || localStorage.getItem('openrouter_api_key') || ''
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [selectedModel, setSelectedModel] = useState('google/gemini-flash-1.5-8b')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)
  const [mode, setMode] = useState('file')
  const [progressMessage, setProgressMessage] = useState('')
  const [testStatus, setTestStatus] = useState(null)
  const [fetchError, setFetchError] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const fetchErrorTimeoutRef = useRef(null)

  const onProgressMessage = useCallback((msg) => setProgressMessage(msg), [])
  const { start: startPolling, stop: stopPolling } = useProgressPolling(onProgressMessage)

  const handleSaveConfig = () => {
    if (apiKey.trim() && apiBaseUrl.trim()) {
      localStorage.setItem('ai_api_key', apiKey)
      localStorage.setItem('ai_api_base_url', apiBaseUrl)
      localStorage.removeItem('openrouter_api_key')
      setConfigSaved(true)
      setTimeout(() => setConfigSaved(false), CONFIG_SAVED_FLASH_MS)
    }
  }

  const handleTestConnection = async () => {
    if (!apiKey.trim() || !apiBaseUrl.trim()) return
    setTestStatus('testing')
    try {
      const response = await axios.post('/api/process/test-connection', {
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim()
      })
      if (response.data.success) {
        setTestStatus({ success: true, message: `Connected! ${response.data.modelCount} models available.` })
      } else {
        setTestStatus({ success: false, message: response.data.error || 'Connection failed' })
      }
    } catch (err) {
      setTestStatus({ success: false, message: err.response?.data?.error || err.message })
    }
    setTimeout(() => setTestStatus(null), TEST_STATUS_FLASH_MS)
  }

  // Fetch available models when API key or base URL changes
  useEffect(() => {
    const fetchModels = async () => {
      if (!apiKey.trim() || !apiBaseUrl.trim()) {
        if (fetchErrorTimeoutRef.current) {
          clearTimeout(fetchErrorTimeoutRef.current)
          fetchErrorTimeoutRef.current = null
        }
        setModels([])
        setFetchError('')
        return
      }

      setLoadingModels(true)
      try {
        const response = await axios.get('/api/process/models', {
          headers: {
            'x-api-key': apiKey,
            'x-api-base-url': apiBaseUrl.trim()
          }
        })
        const sortedModels = response.data.models.sort((a, b) => {
          const aFree = isModelFree(a)
          const bFree = isModelFree(b)
          if (aFree && !bFree) return -1
          if (!aFree && bFree) return 1
          return (b.context_length || 0) - (a.context_length || 0)
        })
        setModels(sortedModels)
        if (fetchErrorTimeoutRef.current) {
          clearTimeout(fetchErrorTimeoutRef.current)
          fetchErrorTimeoutRef.current = null
        }
        setFetchError('')

        const firstFree = sortedModels.find(isModelFree)
        if (firstFree) setSelectedModel(firstFree.id)
      } catch (err) {
        console.warn('Failed to fetch models', err)
        setModels([])
        setFetchError('Failed to fetch models. Check your provider URL/API key and try again.')
        if (fetchErrorTimeoutRef.current) {
          clearTimeout(fetchErrorTimeoutRef.current)
        }
        fetchErrorTimeoutRef.current = setTimeout(() => {
          setFetchError('')
          fetchErrorTimeoutRef.current = null
        }, FETCH_ERROR_FLASH_MS)
      } finally {
        setLoadingModels(false)
      }
    }

    const debounce = setTimeout(fetchModels, MODEL_FETCH_DEBOUNCE_MS)
    return () => clearTimeout(debounce)
  }, [apiKey, apiBaseUrl])

  useEffect(() => {
    return () => {
      if (fetchErrorTimeoutRef.current) {
        clearTimeout(fetchErrorTimeoutRef.current)
      }
    }
  }, [])

  // Elapsed timer while loading
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0)
      return
    }
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  const handleProcess = async (formData) => {
    if (!apiKey.trim()) {
      setError('Please enter your API key')
      return
    }

    setLoading(true)
    setError('')
    setResults(null)
    setProgressMessage('Uploading file...')

    try {
      formData.append('apiKey', apiKey)
      formData.append('apiBaseUrl', apiBaseUrl.trim())
      formData.append('model', selectedModel)

      const selectedModelData = models.find(m => m.id === selectedModel)
      const contextLength = selectedModelData?.context_length || DEFAULT_CONTEXT_LENGTH
      formData.append('contextLength', contextLength)
      if (selectedModelData?.max_completion_tokens) {
        formData.append('maxCompletionTokens', selectedModelData.max_completion_tokens)
      }

      const endpoint = mode === 'file' ? '/api/process/file' : '/api/process/summary'
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
      formData.append('sessionId', sessionId)

      const response = await axios.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: REQUEST_TIMEOUT_MS,
        onUploadProgress: (progressEvent) => {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          setProgressMessage(`Uploading file... ${pct}%`)
          if (pct === 100) {
            setProgressMessage('Upload complete. Processing book...')
            startPolling(sessionId)
          }
        }
      })

      stopPolling()

      if (!response.data) throw new Error('No data received from server')
      if (!response.data.characters || !Array.isArray(response.data.characters)) {
        throw new Error('Invalid response format: missing characters array')
      }

      setProgressMessage('Processing complete! Loading results...')
      setResults(response.data)
      setLoading(false)
    } catch (err) {
      stopPolling()
      const errorMessage = err.response?.data?.error || err.message || 'An error occurred'
      setError(errorMessage)
      setLoading(false)
    } finally {
      setProgressMessage('')
    }
  }

  const selectedModelData = models.find(m => m.id === selectedModel)

  return (
    <div className="container">
      <header>
        <h1>Chatbot Maker</h1>
        <p>Generate character cards and lorebooks from books</p>
      </header>

      <div className="card">
        <h3>AI Provider Configuration</h3>

        <div className="form-group">
          <label className="form-label">Provider URL (OpenAI-compatible)</label>
          <input
            type="text"
            placeholder="https://openrouter.ai/api/v1"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            className="full-width"
          />
          <small>
            Any OpenAI-compatible endpoint — OpenRouter, OpenAI, Ollama (http://localhost:11434/v1), LM Studio, Groq, etc.
          </small>
        </div>

        <div className="form-group">
          <label className="form-label">
            API Key {localStorage.getItem('ai_api_key') && <span className="saved-badge">Saved in cache</span>}
          </label>
          <div className="input-row">
            <input
              type="password"
              placeholder="Enter your API key..."
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setError('') }}
              className="flex-1"
            />
            <button
              onClick={handleSaveConfig}
              disabled={!apiKey.trim() || !apiBaseUrl.trim()}
              className={`save-btn ${configSaved ? 'saved' : 'secondary-btn'}`}
            >
              {configSaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <button
            onClick={handleTestConnection}
            disabled={!apiKey.trim() || !apiBaseUrl.trim() || testStatus === 'testing'}
            className="secondary-btn test-btn"
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {testStatus && testStatus !== 'testing' && (
            <div className={`status-message ${testStatus.success ? 'success' : 'error'}`}>
              {testStatus.message}
            </div>
          )}
        </div>

        <div>
          <label className="form-label">Model</label>
          {fetchError && <div className="status-message error">{fetchError}</div>}

          {loadingModels ? (
            <div className="placeholder-box">Loading models...</div>
          ) : models.length > 0 ? (
            <>
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                disabled={!apiKey.trim()}
              />
              {selectedModelData && (
                <small className="context-info">
                  Context window: {(selectedModelData.context_length / 1000).toFixed(0)}K tokens
                  {selectedModelData.max_completion_tokens && (
                    <> | Max output: {(selectedModelData.max_completion_tokens / 1000).toFixed(0)}K tokens</>
                  )}
                  {' '}- Large books will be automatically chunked at chapter boundaries
                </small>
              )}
            </>
          ) : (
            <div className="placeholder-box">
              {apiKey.trim() ? 'No models found — check your provider URL and API key' : 'Enter API key to load models'}
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
          className={`mode-btn-right ${mode === 'summary' ? 'primary-btn active' : 'secondary-btn'}`}
          onClick={() => setMode('summary')}
        >
          Paste Summary
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>{progressMessage || 'Processing... This may take a few minutes depending on book size.'}</p>
          <small>Elapsed: {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}</small>
          <small>Please keep this tab open</small>
        </div>
      )}

      {!loading && results && (
        <div key={results.sessionId || 'results'}>
          <div className="results-header">
            <small className="results-count">Results loaded - displaying {results.characters?.length || 0} characters</small>
            <button
              className="secondary-btn new-upload-btn"
              onClick={() => { setResults(null); setError('') }}
            >
              New Upload
            </button>
          </div>
          <ErrorBoundary>
            <Results data={results} />
          </ErrorBoundary>
        </div>
      )}

      {!loading && !results && (
        <>
          {mode === 'file' ? (
            <FileUpload onUpload={handleProcess} contextLength={selectedModelData?.context_length || DEFAULT_CONTEXT_LENGTH} />
          ) : (
            <TextSummary onSubmit={handleProcess} />
          )}
          <div className="ready-message">
            <small>Ready to process your book</small>
          </div>
        </>
      )}
    </div>
  )
}

export default App
