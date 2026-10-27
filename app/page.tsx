import Link from 'next/link';
export default function Landing() {
  return <main className="site-home">
    <nav className="site-nav"><Link href="/" className="wordmark">AutomatePal<span>↗</span></Link><div><a href="#workflow">How it works</a><Link href="/login">Sign in</Link><Link href="/workspace" className="nav-cta">Open beta ↗</Link></div></nav>
    <section className="hero">
      <div className="hero-grid" aria-hidden="true" />
      <p className="eyebrow">YOUR PRODUCT. YOUR BILLING. ONE CONVERSATION.</p>
      <h1>Less setup.<br/>More building.</h1>
      <p className="hero-copy">Turn your next idea into a billing workflow.<br/>An AI copilot built with the PayPal sandbox.</p>
      <div className="hero-actions"><Link href="/workspace" className="button-light">Explore the sandbox <span>↗</span></Link><a href="#workflow" className="button-outline">See how it works ↓</a></div>
      <div className="flow-preview" aria-label="Illustrative workflow, not live activity">
        <div className="preview-head"><span className="dot"/> BILLING WORKFLOW <span>ILLUSTRATION / SANDBOX</span></div>
        <div className="request-bubble">“A $12 monthly plan for my new product.”</div>
        <div className="preview-steps"><div><span>01</span><strong>Describe it</strong><p>Start with the product, not an API.</p></div><div><span>02</span><strong>Set it up</strong><p>Products and plans in your sandbox.</p></div><div><span>03</span><strong>See the trail</strong><p>Source-labelled activity. No guesswork.</p></div></div>
      </div>
      <p className="hero-note">Independent hackathon beta · No real money moves · Fictional data only</p>
    </section>
    <section id="workflow" className="workflow"><p className="eyebrow">BUILT FOR FOUNDERS WHO BUILD</p><h2>Keep the idea moving.<br/>Keep the numbers honest.</h2><div className="feature-grid"><article><div className="feature-icon">↗</div><h3>From chat to catalog</h3><p>Describe a product and create sandbox products and monthly plans through a guided conversation.</p></article><article><div className="feature-icon">≡</div><h3>A trail you can read</h3><p>Review recorded actions in a filterable dashboard. Plan creation is never counted as revenue.</p></article><article><div className="feature-icon">◌</div><h3>Safe room to explore</h3><p>Demo scenarios stay clearly fictional. Actions require your review. Production payments and invoice sending are disabled.</p></article></div></section>
    <section className="beta-banner"><div><p className="eyebrow">EARLY, ON PURPOSE</p><h2>Built in the open.</h2><p>A working project in development, not a production payment service. Auth, hosting and end-to-end testing are still being completed.</p></div><a className="button-dark" href="https://github.com/Agenticpirate/automatepal">Explore the source ↗</a></section>
    <footer><Link href="/" className="wordmark">AutomatePal↗</Link><p>PayPal is a trademark of PayPal, Inc. Independent project, not affiliated with or endorsed by PayPal.</p><div><Link href="/privacy">Privacy</Link><Link href="/terms">Beta terms</Link></div></footer>
  </main>;
}
