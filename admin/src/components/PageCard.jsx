export default function PageCard({ title, extra, filters, children }) {
  return (
    <div className="page-card-wrap">
      <div className="page-header">
        <div className="header-top">
          <span className="page-title">{title}</span>
          {extra ? <div className="header-actions">{extra}</div> : null}
        </div>
        {filters ? <div className="filter-bar">{filters}</div> : null}
      </div>
      {children}
    </div>
  )
}
