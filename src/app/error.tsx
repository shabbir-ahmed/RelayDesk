'use client'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="shell page-content" id="main">
    <section className="panel p-6">
      <h1 className="section-title">RelayDesk is temporarily unavailable</h1>
      <p className="muted my-3">The queue could not be loaded. Try again in a moment.</p>
      <button type="button" className="button button-primary" onClick={reset}>Try again</button>
    </section>
  </main>
}
