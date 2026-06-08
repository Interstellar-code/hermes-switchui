/** Maximum file size accepted from picker/drop before processing (50MB). */
export const MAX_ATTACHMENT_FILE_SIZE = 50 * 1024 * 1024
/** Longest side target for resized images. */
export const MAX_IMAGE_DIMENSION = 1920
/** Initial JPEG compression quality (0-1). */
export const IMAGE_QUALITY = 0.85
/** Safe image attachment limit after processing (1MB). */
export const MAX_TRANSPORT_IMAGE_SIZE = 1 * 1024 * 1024

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function isCanvasSupported(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('2d'))
  } catch {
    return false
  }
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  if (!base64) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

export async function compressImageToDataUrl(file: File): Promise<string> {
  if (!isCanvasSupported()) {
    throw new Error('Image compression not available')
  }

  return await new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    const cleanup = () => URL.revokeObjectURL(objectUrl)

    image.onload = () => {
      try {
        let width = image.width
        let height = image.height

        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_IMAGE_DIMENSION) / width)
            width = MAX_IMAGE_DIMENSION
          } else {
            width = Math.round((width * MAX_IMAGE_DIMENSION) / height)
            height = MAX_IMAGE_DIMENSION
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          cleanup()
          reject(new Error('Failed to get canvas context'))
          return
        }

        context.drawImage(image, 0, 0, width, height)

        let quality = IMAGE_QUALITY
        let dataUrl = canvas.toDataURL('image/jpeg', quality)
        let bytes = estimateDataUrlBytes(dataUrl)

        while (bytes > MAX_TRANSPORT_IMAGE_SIZE && quality > 0.4) {
          quality -= 0.08
          dataUrl = canvas.toDataURL('image/jpeg', quality)
          bytes = estimateDataUrlBytes(dataUrl)
        }

        cleanup()
        resolve(dataUrl)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error('Compression failed'))
      }
    }

    image.onerror = () => {
      cleanup()
      reject(new Error('Failed to load image'))
    }

    image.src = objectUrl
  })
}
