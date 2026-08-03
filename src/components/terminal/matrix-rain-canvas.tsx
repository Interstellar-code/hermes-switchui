import { useEffect, useRef } from 'react'

type Props = {
  /** Set false when the terminal pane is not currently shown. */
  active?: boolean
  fontSize?: number
  speed?: number
  density?: number
  columnSpacing?: number
  className?: string
}

const GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.="*+-<>¦|_'

export function MatrixRainCanvas({
  active = true,
  fontSize = 16,
  speed = 0.06,
  density = 0.35,
  columnSpacing = 0.7,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let cols = 0
    let drops: Array<number> = []
    let lastTs = 0
    let isIntersecting = false
    let isDocumentVisible = !document.hidden
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    function shouldAnimate() {
      return (
        active && isIntersecting && isDocumentVisible && !motionQuery.matches
      )
    }

    function stop() {
      cancelAnimationFrame(raf)
      raf = 0
      lastTs = 0
    }

    function start() {
      if (!raf && shouldAnimate()) raf = requestAnimationFrame(draw)
    }

    function updateAnimation() {
      if (shouldAnimate()) start()
      else stop()
    }

    function resize() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.max(1, Math.floor(rect.width / (fontSize * columnSpacing)))
      drops = new Array(cols).fill(0).map(() => Math.random() * -rect.height)
    }

    function draw(ts: number) {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const dt = lastTs ? Math.min(64, ts - lastTs) : 16
      lastTs = ts

      // Fade trail — lighter = longer trail
      ctx!.fillStyle = 'rgba(0, 0, 0, 0.05)'
      ctx!.fillRect(0, 0, rect.width, rect.height)

      ctx!.font = `${fontSize}px ui-monospace, "JetBrains Mono", Menlo, monospace`
      ctx!.textBaseline = 'top'

      const step = (fontSize * speed * dt) / 32

      for (let i = 0; i < cols; i++) {
        if (Math.random() > density) continue
        const y = drops[i]
        const x = i * fontSize * columnSpacing
        const ch = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length))

        // Head — soft white-green
        ctx!.fillStyle = 'rgba(210, 255, 220, 0.85)'
        ctx!.fillText(ch, x, y)

        // Body — light green (occasional)
        if (Math.random() > 0.85) {
          ctx!.fillStyle = 'rgba(140, 255, 170, 0.45)'
          ctx!.fillText(
            GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)),
            x,
            y - fontSize * (2 + Math.floor(Math.random() * 4)),
          )
        }

        drops[i] = y + step
        if (drops[i] > rect.height && Math.random() > 0.975) {
          drops[i] = -fontSize * 4
        }
      }

      raf = 0
      start()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(
      function updateIntersection(entries) {
        isIntersecting = entries[0]?.isIntersecting ?? false
        updateAnimation()
      },
      { threshold: 0.01 },
    )
    io.observe(canvas)
    const onVisibilityChange = function onVisibilityChange() {
      isDocumentVisible = !document.hidden
      updateAnimation()
    }
    const onMotionChange = function onMotionChange() {
      updateAnimation()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionChange)

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onMotionChange)
    }
  }, [active, fontSize, speed, density, columnSpacing])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
