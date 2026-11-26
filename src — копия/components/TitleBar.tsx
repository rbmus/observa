import Logo from './Logo'

export default function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <Logo size={16} />
        <span>OBSERVA</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => window.observa.winMinimize()}
          aria-label="Свернуть"
          title="Свернуть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={() => window.observa.winToggleMaximize()}
          aria-label="Развернуть"
          title="Развернуть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="titlebar-btn close"
          onClick={() => window.observa.winClose()}
          aria-label="Закрыть"
          title="Закрыть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
