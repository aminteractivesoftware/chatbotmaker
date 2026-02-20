import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>Something went wrong</h3>
          <p style={{ color: 'var(--secondary-text)', marginBottom: '15px' }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering this section.'}
          </p>
          <button
            className="secondary-btn"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
