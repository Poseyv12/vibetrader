export function Panel({
  title,
  right,
  children,
  className = "",
  style,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel panel-corners ${className}`} style={style}>
      <div className="corner-b" aria-hidden />
      {title && (
        <div className="panel-title">
          <span className="tick">▸</span>
          <span className="flex-1">{title}</span>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
