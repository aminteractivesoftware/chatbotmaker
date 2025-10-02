import { useState, useRef, useEffect } from 'react'
import './ModelSelector.css'

function ModelSelector({ models, selectedModel, onSelectModel, disabled }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showOnlyFree, setShowOnlyFree] = useState(true)
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

    const matchesFree = !showOnlyFree ||
      (model.pricing?.prompt === '0' && model.pricing?.completion === '0') ||
      model.id.includes('free')

    return matchesSearch && matchesFree
  })

  const selectedModelData = models.find(m => m.id === selectedModel)
  const isFree = (model) =>
    (model.pricing?.prompt === '0' && model.pricing?.completion === '0') ||
    model.id.includes('free')

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
                {isFree(selectedModelData) && ' 🆓'}
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
          </div>

          <div className="model-selector-list">
            {filteredModels.length > 0 ? (
              filteredModels.map(model => (
                <div
                  key={model.id}
                  className={`model-selector-item ${model.id === selectedModel ? 'selected' : ''}`}
                  onClick={() => handleSelect(model.id)}
                >
                  <div className="model-name">
                    {model.name || model.id}
                    {isFree(model) && <span className="free-badge">🆓</span>}
                  </div>
                  <div className="model-context">
                    {(model.context_length / 1000).toFixed(0)}K tokens
                  </div>
                </div>
              ))
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
