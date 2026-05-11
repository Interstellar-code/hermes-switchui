import { useEffect, useRef } from 'react'

type Props = {
  fontSize?: number
  speed?: number
  density?: number
  columnSpacing?: number
  className?: string
}

const GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.="*+-<>¦|_'

export function MatrixRainCanvas({
  fontSize = 16,
  speed = 0.08,
  density = 2,
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
    let dpr = window.devicePixelRatio || 1
    let cols = 0
    let drops: Array<number> = []
    let lastTs = 0

    function resize() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      dpr = window.devicePixelRatio || 1
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
        if (Math.random() > density * 0.985) continue
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

      raf = requestAnimationFrame(draw)
    }

    resize()
    raf = requestAnimationFrame(draw)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [fontSize, speed, density, columnSpacing])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
