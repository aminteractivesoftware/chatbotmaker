import { useState, useRef, useEffect } from 'react'
import { isModelFree } from '../utils/modelUtils'
import './ModelSelector.css'

function ModelSelector({ models, selectedModel, onSelectModel, disabled }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showOnlyFree, setShowOnlyFree] = useState(true)
  const [sortBy, setSortBy] = useState('context') // 'name' | 'context' | 'price'
  const dropdownRef = useRef(null)
  const searchInputRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const filteredModels = models.filter(model => {
    const matchesSearch = search === '' ||
      model.id.toLowerCase().includes(search.toLowerCase()) ||
      (model.name || '').toLowerCase().includes(search.toLowerCase())

    const matchesFree = !showOnlyFree || isModelFree(model)

    return matchesSearch && matchesFree
  }).sort((a, b) => {
    if (sortBy === 'name') {
      return (a.name || a.id).localeCompare(b.name || b.id)
    }
    if (sortBy === 'price') {
      const aPrice = parseFloat(a.pricing?.prompt) || 0
      const bPrice = parseFloat(b.pricing?.prompt) || 0
      return aPrice - bPrice // cheapest first
    }
    // 'context' — largest context first
    return (b.context_length || 0) - (a.context_length || 0)
  })

  const selectedModelData = models.find(m => m.id === selectedModel)

  const formatPrice = (model) => {
    if (!model.pricing) return null
    if (isModelFree(model)) return 'Free'
    const prompt = parseFloat(model.pricing.prompt)
    const completion = parseFloat(model.pricing.completion)
    if (isNaN(prompt) && isNaN(completion)) return null
    // Negative values are sentinel/variable pricing (e.g. Auto Router)
    if (prompt < 0 || completion < 0) return 'Variable pricing'
    // Prices from OpenRouter are per-token; convert to per-million-tokens for readability
    const promptPerM = (prompt * 1_000_000).toFixed(2)
    const completionPerM = (completion * 1_000_000).toFixed(2)
    return `$${promptPerM} / $${completionPerM} per 1M tokens`
  }

  const handleSelect = (modelId) => {
    onSelectModel(modelId)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        type="button"
        className="model-selector-button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span className="model-selector-text">
          {selectedModelData ? (
            <>
              {selectedModelData.name || selectedModelData.id}
              <span className="model-context">
                {' '}({(selectedModelData.context_length / 1000).toFixed(0)}K ctx)
                {isModelFree(selectedModelData) && ' 🆓'}
              </span>
            </>
          ) : (
            'Select a model'
          )}
        </span>
        <span className={`model-selector-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          <div className="model-selector-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="model-selector-filter">
            <label>
              <input
                type="checkbox"
                checked={showOnlyFree}
                onChange={(e) => setShowOnlyFree(e.target.checked)}
              />
              Show only free models
            </label>
            <div className="model-selector-sort">
              <span className="sort-label">Sort:</span>
              <button
                type="button"
                className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setSortBy('name') }}
              >
                Name
              </button>
              <button
                type="button"
                className={`sort-btn ${sortBy === 'context' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setSortBy('context') }}
              >
                Context
              </button>
              <button
                type="button"
                className={`sort-btn ${sortBy === 'price' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setSortBy('price') }}
              >
                Price
              </button>
            </div>
          </div>

          <div className="model-selector-list">
            {filteredModels.length > 0 ? (
              filteredModels.map(model => {
                const price = formatPrice(model)
                return (
                  <div
                    key={model.id}
                    className={`model-selector-item ${model.id === selectedModel ? 'selected' : ''}`}
                    onClick={() => handleSelect(model.id)}
                  >
                    <div className="model-name">
                      {model.name || model.id}
                      {isModelFree(model) && <span className="free-badge">🆓</span>}
                    </div>
                    <div className="model-meta">
                      <span className="model-context-small">
                        {(model.context_length / 1000).toFixed(0)}K tokens
                      </span>
                      {price && (
                        <span className="model-price">{price}</span>
                      )}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="model-selector-empty">
                No models match your filters
              </div>
            )}
          </div>

          {filteredModels.length > 0 && filteredModels.length !== models.length && (
            <div className="model-selector-footer">
              Showing {filteredModels.length} of {models.length} models
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ModelSelector
