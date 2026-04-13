import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import styles from './CliPage.module.css'

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })

let diagramCounter = 0

function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const id = `mermaid-diagram-${++diagramCounter}`
    ref.current.innerHTML = ''
    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg
      })
      .catch(() => {
        if (ref.current) ref.current.textContent = chart
      })
  }, [chart])

  return <div className={styles.diagramWrap} ref={ref} />
}

const flowChart = `flowchart LR
  A[AI Agent] --> B[Generate Long URL]
  B --> C[leaflet-cli shorten]
  C --> D[Leaflet Backend]
  D --> E[Short-lived URL]
  E --> F[User receives clean link]`

const sequenceDiagram = `sequenceDiagram
  participant AI as AI Agent
  participant CLI as leaflet-cli
  participant API as Leaflet API
  AI->>AI: Generate long URL
  AI->>CLI: Execute shorten command
  CLI->>API: OAuth-authenticated request
  API->>CLI: Return short URL
  CLI->>AI: JSON output
  AI->>User: Returns shortened link`

export default function CliPage() {
  return (
    <div className={`page-container-wide ${styles.content}`}>
      {/* Hero */}
      <header className={styles.header}>
        <h1 className={styles.title}>CLI Usage</h1>
        <p className={styles.tagline}>
          Leaflet CLI enables automated URL shortening via OAuth 2.0 authentication.
          Turn long URLs into short-lived, privacy-first links programmatically —
          no browser required.
        </p>
        <div className={styles.badges}>
          <span className={styles.badge}>AI Agents</span>
          <span className={styles.badge}>Automation Scripts</span>
          <span className={styles.badge}>Backend Services</span>
          <span className={styles.badge}>OAuth 2.0 + PKCE</span>
        </div>
      </header>

      {/* Section 1: Why CLI */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Why CLI Usage Matters</h2>
        <p className={styles.prose}>
          The CLI is the preferred way for non-browser systems to interact with Leaflet.
        </p>
        <ul className={styles.useCaseList}>
          <li>AI chatbot generating long documentation or product URLs</li>
          <li>Agents summarizing content and returning clean links</li>
          <li>Automation pipelines posting links in messages or emails</li>
        </ul>
        <MermaidDiagram chart={flowChart} />
      </section>

      {/* Section 2: Installation */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Installation</h2>
        <p className={styles.prose}>
          The CLI lives in the <code>cli/</code> workspace of the Leaflet monorepo.
        </p>
        <div className={styles.codeGroup}>
          <div className={styles.codeBlock}>
            <div className={styles.codeLabel}>Build from source</div>
            <pre><code>{`git clone https://github.com/nntin/leaflet.git
cd leaflet
npm install
npm run build --workspace cli`}</code></pre>
          </div>
          <div className={styles.codeBlock}>
            <div className={styles.codeLabel}>Optional — global install</div>
            <pre><code>{`npm install -g leaflet-cli`}</code></pre>
          </div>
        </div>
      </section>

      {/* Section 3: Auth */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Authentication (OAuth 2.0)</h2>
        <p className={styles.prose}>
          Leaflet CLI uses OAuth 2.0 Authorization Code Flow with PKCE. No API keys required.
        </p>
        <div className={styles.codeBlock} style={{ marginBottom: '1rem' }}>
          <div className={styles.codeLabel}>Login</div>
          <pre><code>{`leaflet auth login`}</code></pre>
        </div>
        <p className={styles.prose}>
          A browser window opens for GitHub authentication. The access token is stored locally
          and reused for subsequent requests.
        </p>
        <div className={styles.infoRow}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Security</span>
            <span className={styles.infoValue}>OAuth only</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Access Control</span>
            <span className={styles.infoValue}>Scoped tokens</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Environments</span>
            <span className={styles.infoValue}>Local &amp; CI</span>
          </div>
        </div>
      </section>

      {/* Section 4: Basic Usage */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Basic Usage</h2>
        <table className={styles.cmdTable}>
          <thead>
            <tr>
              <th>Command</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>leaflet auth status</code></td>
              <td>Check authentication status and granted scopes</td>
            </tr>
            <tr>
              <td><code>leaflet shorten &lt;url&gt;</code></td>
              <td>Shorten a URL</td>
            </tr>
            <tr>
              <td><code>leaflet shorten &lt;url&gt; --json</code></td>
              <td>JSON output for AI agents and automation pipelines</td>
            </tr>
            <tr>
              <td><code>leaflet shorten &lt;url&gt; --ttl 24h</code></td>
              <td>Set a custom expiry (e.g. 24 hours)</td>
            </tr>
          </tbody>
        </table>
        <p className={styles.prose} style={{ marginTop: '0.75rem' }}>
          <code>--json</code> output includes <code>shortUrl</code> and optional metadata.
          Use it whenever the result is consumed programmatically.
        </p>
      </section>

      {/* Section 5: AI Agent Integration */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Agent Integration</h2>
        <p className={styles.prose}>
          The CLI is designed for tool-calling systems and AI workflows. After a one-time
          login, it operates fully autonomously — no manual intervention required.
        </p>
        <MermaidDiagram chart={sequenceDiagram} />
        <div className={styles.codeGroup} style={{ marginTop: '1.25rem' }}>
          <div className={styles.codeBlock}>
            <div className={styles.codeLabel}>Example — shorten a URL and capture the output</div>
            <pre><code>{`leaflet shorten "https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication" --json`}</code></pre>
          </div>
          <div className={styles.codeBlock}>
            <div className={styles.codeLabel}>Output</div>
            <pre><code>{`{
  "shortUrl": "https://your-leaflet-instance/s/abc123",
  "expiresAt": "2026-04-14T12:00:00Z"
}`}</code></pre>
          </div>
        </div>
        <div className={styles.infoRow} style={{ marginTop: '1rem' }}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Ideal for</span>
            <span className={styles.infoValue}>AI assistants</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Intervention</span>
            <span className={styles.infoValue}>None after setup</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Rate limits</span>
            <span className={styles.infoValue}>Respected</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Execution</span>
            <span className={styles.infoValue}>Server-safe</span>
          </div>
        </div>
      </section>

      <p className={styles.footerNote}>
        Leaflet CLI is part of the Leaflet ecosystem and uses the same OAuth server as the
        Developer API and browser integration.
      </p>
    </div>
  )
}
