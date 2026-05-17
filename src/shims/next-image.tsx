import type { ImgHTMLAttributes } from 'react'

export default function Image(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <img alt={props.alt ?? ''} {...props} />
}
