import { useEffect, useState } from 'react'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './WindowControls.module.css'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    void window.api.app
      .isWindowMaximized()
      .then((value) => {
        if (active) setMaximized(!!value)
      })
      .catch(() => {})

    const unsub = window.api.app.onWindowMaximizedChange((value) => {
      setMaximized(!!value)
    })

    return () => {
      active = false
      unsub()
    }
  }, [])

  return (
    <div className={styles.windowControls}>
      <Tooltip label="Minimize window">
        <button
          aria-label="Minimize window"
          className={styles.windowControlButton}
          onClick={(e) => {
            e.stopPropagation()
            window.api.app.minimizeWindow()
          }}
        >
          <span className={`${styles.windowControlGlyph} ${styles.windowControlGlyphMinimize}`} />
        </button>
      </Tooltip>

      <Tooltip label={maximized ? 'Restore window' : 'Maximize window'}>
        <button
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          className={styles.windowControlButton}
          onClick={(e) => {
            e.stopPropagation()
            window.api.app.toggleMaximizeWindow()
          }}
        >
          <span
            className={`${styles.windowControlGlyph} ${
              maximized ? styles.windowControlGlyphRestore : styles.windowControlGlyphMaximize
            }`}
          />
        </button>
      </Tooltip>

      <Tooltip label="Close window">
        <button
          aria-label="Close window"
          className={`${styles.windowControlButton} ${styles.windowControlButtonClose}`}
          onClick={(e) => {
            e.stopPropagation()
            window.api.app.closeWindow()
          }}
        >
          <span className={`${styles.windowControlGlyph} ${styles.windowControlGlyphClose}`} />
        </button>
      </Tooltip>
    </div>
  )
}
