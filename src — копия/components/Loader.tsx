interface Props {
  size?: number
}

export default function Loader({ size = 28 }: Props) {
  return <span className="loader" style={{ width: size, height: size }} aria-label="Загрузка" />
}
