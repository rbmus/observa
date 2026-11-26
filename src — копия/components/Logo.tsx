import { useId } from 'react'

interface Props {
  size?: number
}

export default function Logo({ size = 28 }: Props) {
  const id = useId().replace(/:/g, '')
  const maskId = `observa-mark-${id}`
  const gradientId = `observa-mark-gradient-${id}`
  const height = Math.round(size * 616 / 544)

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 544 616"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <mask id={maskId} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="544" height="616">
        <path d="M413.734 83.9394L544 8.13214e-05V512.962L413.734 615.555V83.9394Z" fill="white" />
        <path d="M206.408 208.5L337.592 124.527V512.921L206.408 615.555V208.5Z" fill="white" />
        <path d="M0 344L130.266 260.145V513.066L0 615.555V344Z" fill="white" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect y="0.277344" width="544" height="615" fill={`url(#${gradientId})`} />
      </g>
      <defs>
        <radialGradient id={gradientId} cx="0" cy="0" r="1" gradientTransform="matrix(-272 615 -544 -240.165 544 0.277307)" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="#8D8D8D" />
        </radialGradient>
      </defs>
    </svg>
  )
}
