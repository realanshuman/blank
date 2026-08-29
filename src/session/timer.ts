import { useCallback, useEffect, useRef, useState } from 'react'

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished'

export interface Timer {
  status: TimerStatus
  /** Whole seconds left on the clock. */
  remaining: number
  label: string
  start(): void
  pause(): void
  reset(minutes?: number): void
  toggle(): void
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * A short, soft chime built with the Web Audio API rather than a bundled asset
 * — the sound at the end of a sprint should not cost a network request or a
 * file in the repo.
 */
function chime(): void {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return

    const context = new AudioCtor()
    const now = context.currentTime

    for (const [index, frequency] of [660, 880].entries()) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency

      const at = now + index * 0.18
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.16, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)

      oscillator.connect(gain).connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.55)
    }

    setTimeout(() => void context.close(), 1400)
  } catch {
    // Audio is a nicety. A blocked or unavailable AudioContext must never
    // interrupt the writing session.
  }
}

/**
 * Countdown driven by wall-clock deadline rather than by accumulating ticks,
 * so it stays accurate when the tab is backgrounded and the interval is
 * throttled.
 */
export function useTimer(minutes: number): Timer {
  const [status, setStatus] = useState<TimerStatus>('idle')
  const [remaining, setRemaining] = useState(minutes * 60)
  const deadline = useRef<number | null>(null)

  // Changing the configured length while idle should move the clock.
  useEffect(() => {
    if (status === 'idle') setRemaining(minutes * 60)
  }, [minutes, status])

  useEffect(() => {
    if (status !== 'running') return

    const tick = () => {
      if (deadline.current === null) return
      const left = Math.max(0, Math.round((deadline.current - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) {
        setStatus('finished')
        deadline.current = null
        chime()
      }
    }

    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [status])

  const start = useCallback(() => {
    setStatus((current) => {
      if (current === 'running') return current
      setRemaining((left) => {
        const seconds = left > 0 ? left : minutes * 60
        deadline.current = Date.now() + seconds * 1000
        return seconds
      })
      return 'running'
    })
  }, [minutes])

  const pause = useCallback(() => {
    setStatus((current) => (current === 'running' ? 'paused' : current))
    deadline.current = null
  }, [])

  const reset = useCallback(
    (nextMinutes?: number) => {
      deadline.current = null
      setStatus('idle')
      setRemaining((nextMinutes ?? minutes) * 60)
    },
    [minutes],
  )

  const toggle = useCallback(() => {
    if (status === 'running') {
      pause()
    } else if (status === 'finished') {
      reset()
    } else {
      start()
    }
  }, [status, pause, reset, start])

  return { status, remaining, label: formatClock(remaining), start, pause, reset, toggle }
}
