import Link from 'next/link'

export default function NotFound() {
  return <main className="shell page-content" id="main">
    <section className="panel p-6">
      <h1 className="section-title">Page not found</h1>
      <p className="muted my-3">The requested page or delivery could not be found.</p>
      <Link href="/" className="button button-secondary">Back to deliveries</Link>
    </section>
  </main>
}
