import { deterministicGitHubAppName } from '@runharbor/contracts';

export interface PageShellOptions {
  readonly title: string;
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly currentStep: 1 | 2 | 3 | 'error';
  readonly content: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] as string));
}

const INLINE_CSS = `
:root {
  --color-bg: #f8fafc;
  --color-surface: #ffffff;
  --color-surface-hover: #f1f5f9;
  --color-text: #0f172a;
  --color-text-muted: #475569;
  --color-text-dim: #64748b;
  --color-border: #e2e8f0;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-active: #1e40af;
  --color-primary-focus: rgba(37, 99, 235, 0.35);
  --color-success-bg: #f0fdf4;
  --color-success-border: #bbf7d0;
  --color-success-text: #166534;
  --color-success-badge: #dcfce7;
  --color-warning-bg: #fffbeb;
  --color-warning-border: #fde68a;
  --color-warning-text: #854d0e;
  --color-warning-badge: #fef3c7;
  --color-error-bg: #fef2f2;
  --color-error-border: #fecaca;
  --color-error-text: #991b1b;
  --color-error-badge: #fee2e2;
  --color-info-bg: #eff6ff;
  --color-info-border: #bfdbfe;
  --color-info-text: #1e40af;
  --radius-lg: 14px;
  --radius-md: 8px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0b0f19;
    --color-surface: #131b2e;
    --color-surface-hover: #1c2640;
    --color-text: #f8fafc;
    --color-text-muted: #94a3b8;
    --color-text-dim: #64748b;
    --color-border: #1e293b;
    --color-primary: #3b82f6;
    --color-primary-hover: #2563eb;
    --color-primary-active: #1d4ed8;
    --color-primary-focus: rgba(59, 130, 246, 0.4);
    --color-success-bg: #062e1e;
    --color-success-border: #0d5f3d;
    --color-success-text: #86efac;
    --color-success-badge: #0a432b;
    --color-warning-bg: #2e1d08;
    --color-warning-border: #633e10;
    --color-warning-text: #fde047;
    --color-warning-badge: #45290a;
    --color-error-bg: #311114;
    --color-error-border: #691d24;
    --color-error-text: #fca5a5;
    --color-error-badge: #4c141a;
    --color-info-bg: #0c2340;
    --color-info-border: #184178;
    --color-info-text: #93c5fd;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
  }
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-family);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  background-color: var(--color-bg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 2.5rem 1rem;
}

.container {
  width: 100%;
  max-width: 620px;
  margin: 0 auto;
}

/* Header & Branding */
.header {
  margin-bottom: 2rem;
  text-align: left;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.brand-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, var(--color-primary), #4f46e5);
  color: #ffffff;
  border-radius: var(--radius-md);
  font-weight: 800;
  font-size: 1.125rem;
  box-shadow: var(--shadow-sm);
}

.brand-title {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.03em;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.page-subtitle {
  font-size: 0.9375rem;
  color: var(--color-text-muted);
}

/* Stepper */
.stepper-nav {
  margin-bottom: 2rem;
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  list-style: none;
  position: relative;
}

.stepper::before {
  content: "";
  position: absolute;
  top: 16px;
  left: 32px;
  right: 32px;
  height: 2px;
  background-color: var(--color-border);
  z-index: 0;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
  background-color: var(--color-bg);
  padding: 0 0.5rem;
}

.step-bubble {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: var(--color-surface);
  border: 2px solid var(--color-border);
  color: var(--color-text-dim);
  font-weight: 700;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.375rem;
  transition: all 0.2s ease;
}

.step-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text-dim);
}

.step.step-active .step-bubble {
  border-color: var(--color-primary);
  background-color: var(--color-primary);
  color: #ffffff;
  box-shadow: 0 0 0 4px var(--color-primary-focus);
}

.step.step-active .step-label {
  color: var(--color-text);
  font-weight: 700;
}

.step.step-done .step-bubble {
  border-color: var(--color-success-border);
  background-color: var(--color-success-badge);
  color: var(--color-success-text);
}

.step.step-done .step-label {
  color: var(--color-success-text);
  font-weight: 600;
}

/* Cards */
.card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 2rem;
  box-shadow: var(--shadow-md);
  margin-bottom: 1.5rem;
}

.card-header {
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.card-title {
  font-size: 1.1875rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.card p {
  margin-bottom: 1rem;
  color: var(--color-text);
  font-size: 0.9375rem;
}

.card p:last-child {
  margin-bottom: 0;
}

.card strong {
  color: var(--color-text);
}

.card code {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.125rem 0.375rem;
}

/* Status Badges */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 9999px;
}

.status-badge-info {
  background-color: var(--color-info-bg);
  border: 1px solid var(--color-info-border);
  color: var(--color-info-text);
}

.status-badge-success {
  background-color: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--color-success-text);
}

.status-badge-warning {
  background-color: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning-text);
}

.status-badge-error {
  background-color: var(--color-error-bg);
  border: 1px solid var(--color-error-border);
  color: var(--color-error-text);
}

/* Callouts */
.callout {
  padding: 1rem 1.125rem;
  border-radius: var(--radius-md);
  margin: 1.25rem 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.callout-info {
  background-color: var(--color-info-bg);
  border: 1px solid var(--color-info-border);
  color: var(--color-info-text);
}

.callout-warning {
  background-color: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning-text);
}

.callout-success {
  background-color: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--color-success-text);
}

.callout-error {
  background-color: var(--color-error-bg);
  border: 1px solid var(--color-error-border);
  color: var(--color-error-text);
}

/* Forms & Controls */
.form-group {
  margin: 1.25rem 0;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
  color: var(--color-text);
}

.form-label-optional {
  font-weight: 400;
  color: var(--color-text-muted);
}

.form-input {
  display: block;
  width: 100%;
  padding: 0.6875rem 0.875rem;
  font-size: 0.9375rem;
  font-family: var(--font-family);
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form-input::placeholder {
  color: var(--color-text-dim);
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-focus);
}

.form-hint {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin-top: 0.375rem;
}

.form-actions {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  font-family: var(--font-family);
  line-height: 1.35;
  text-decoration: none;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  min-height: 44px;
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
}

.btn-primary, button[type="submit"] {
  background-color: var(--color-primary);
  color: #ffffff;
  border-color: var(--color-primary);
}

.btn-primary:hover, button[type="submit"]:hover {
  background-color: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}

.btn-primary:active, button[type="submit"]:active {
  background-color: var(--color-primary-active);
  transform: scale(0.99);
}

/* Visible Focus Outline */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.next-steps-list {
  margin-top: 1rem;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.next-steps-list li {
  margin-bottom: 0.5rem;
}

/* Responsive adjustment */
@media (max-width: 540px) {
  body {
    padding: 1.25rem 0.75rem;
  }
  .card {
    padding: 1.25rem;
  }
  .stepper-nav {
    margin-bottom: 1.5rem;
  }
  .stepper::before {
    display: none;
  }
  .stepper {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .step {
    flex-direction: row;
    padding: 0;
    gap: 0.75rem;
  }
  .step-bubble {
    margin-bottom: 0;
  }
}
`.trim();

function renderStepper(currentStep: 1 | 2 | 3 | 'error'): string {
  if (currentStep === 'error') return '';
  const steps = [
    { num: 1, label: 'Configure App' },
    { num: 2, label: 'Install on GitHub' },
    { num: 3, label: 'Activate' },
  ];
  const items = steps.map((step) => {
    let stateClass = '';
    let bubbleContent = `${step.num}`;
    let ariaCurrent = '';
    if (step.num < currentStep) {
      stateClass = 'step-done';
      bubbleContent = '✓';
    } else if (step.num === currentStep) {
      stateClass = 'step-active';
      ariaCurrent = ' aria-current="step"';
    }
    return `    <li class="step ${stateClass}"${ariaCurrent}>
      <span class="step-bubble" aria-hidden="true">${bubbleContent}</span>
      <span class="step-label">${step.label}</span>
    </li>`;
  }).join('\n');

  return `<nav aria-label="Setup Progress" class="stepper-nav">
  <ol class="stepper">
${items}
  </ol>
</nav>`;
}

export function pageShell(options: PageShellOptions): string {
  const stepperHtml = renderStepper(options.currentStep);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(options.title)}</title>
  <style>${INLINE_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="brand-row">
        <div class="brand-logo" aria-hidden="true">⚓</div>
        <span class="brand-title">RunHarbor</span>
      </div>
      <h1 class="page-title">${escapeHtml(options.pageTitle)}</h1>
      <p class="page-subtitle">${escapeHtml(options.pageSubtitle)}</p>
    </header>
    ${stepperHtml}
    <main>
      ${options.content}
    </main>
  </div>
</body>
</html>`;
}

export function renderSetupStartPage(organizationLogin?: string): string {
  const defaultAppName = organizationLogin !== undefined ? deterministicGitHubAppName(organizationLogin) : '';
  const orgInfo = organizationLogin !== undefined
    ? `<p>This App will be owned by <strong>${escapeHtml(organizationLogin)}</strong>.</p><p>Proposed GitHub App name: <strong>${escapeHtml(defaultAppName)}</strong></p><p class="form-hint">The GitHub App name is deterministically generated as &quot;RunHarbor (&lt;org&gt;)&quot; (max 34 characters) from the verified GitHub organization to avoid global collisions.</p>`
    : '';

  const overrideSection = organizationLogin !== undefined
    ? `<div class="form-group">
      <label for="app_name" class="form-label">Custom App Name <span class="form-label-optional">(Optional override)</span></label>
      <input type="text" id="app_name" name="app_name" class="form-input" maxlength="34" placeholder="${escapeHtml(defaultAppName)}" autocomplete="off" spellcheck="false" pattern="^[A-Za-z0-9(][A-Za-z0-9 _().-]{0,32}[A-Za-z0-9)]?$">
      <p class="form-hint">1–34 characters: letters, numbers, spaces, hyphens, underscores, dots, or parentheses. Cannot be the globally reserved name &quot;RunHarbor&quot;.</p>
    </div>`
    : '';

  const content = `
<section class="card">
  <div class="card-header">
    <h2 class="card-title">GitHub App Details</h2>
  </div>
  ${orgInfo}
  <form method="post" action="/setup/begin" class="setup-form">
    ${overrideSection}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Create GitHub App</button>
    </div>
  </form>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'Configure GitHub App',
    pageSubtitle: 'Connect your AWS runner environment to GitHub Actions with a customer-owned GitHub App.',
    currentStep: 1,
    content,
  });
}

export function renderManifestPage(state: string, manifest: string, organizationLogin: string, appName: string): string {
  const action = `https://github.com/organizations/${encodeURIComponent(organizationLogin)}/settings/apps/new`;
  const content = `
<section class="card">
  <div class="card-header">
    <h2 class="card-title">Manifest Confirmation</h2>
  </div>
  <p>This App will be owned by <strong>${escapeHtml(organizationLogin)}</strong>.</p>
  <p>Proposed GitHub App name: <strong>${escapeHtml(appName)}</strong></p>
  <p class="form-hint">The GitHub App name is deterministically generated as &quot;RunHarbor (&lt;org&gt;)&quot; (max 34 characters) from the verified GitHub organization to avoid global collisions.</p>
  <div class="callout callout-info">
    <p>Click <strong>Create GitHub App</strong> to submit your manifest to GitHub under <strong>${escapeHtml(organizationLogin)}</strong>. GitHub will configure the webhook and permissions, then redirect back to complete installation.</p>
  </div>
  <form method="post" action="${escapeHtml(action)}" class="setup-form">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Create GitHub App</button>
    </div>
  </form>
</section>`;

  return pageShell({
    title: 'Create GitHub App',
    pageTitle: 'Register with GitHub',
    pageSubtitle: 'Submit the generated manifest to GitHub to create your connector App.',
    currentStep: 1,
    content,
  });
}

export function renderInstallPage(slug: string): string {
  const url = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  const content = `
<section class="card">
  <div class="card-header">
    <h2 class="card-title">Repository Access Configuration</h2>
  </div>
  <div class="callout callout-warning">
    <p><strong>Requirement:</strong> Install the GitHub App on its owning organization and select <strong>All repositories</strong>. RunHarbor will reject a personal-account or selected-repository installation.</p>
  </div>
  <p>Your GitHub App <strong>${escapeHtml(slug)}</strong> has been registered. Complete the installation on GitHub to authorize it for workflow runs.</p>
  <div class="form-actions">
    <a href="${escapeHtml(url)}" class="btn btn-primary" role="button">Install ${escapeHtml(slug)}</a>
  </div>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'Install GitHub App',
    pageSubtitle: 'Grant the connector access to repositories in your GitHub organization.',
    currentStep: 2,
    content,
  });
}

export function renderSuccessPage(): string {
  const content = `
<section class="card">
  <div class="card-header">
    <span class="status-badge status-badge-success">Operational</span>
    <h2 class="card-title" style="margin-top: 0.5rem;">RunHarbor is active.</h2>
  </div>
  <p>Your Connector is registered with SaaS and listening for GitHub Actions workflow jobs. Runner instances will launch on demand within your AWS account.</p>
  <div class="callout callout-success">
    <p>Connector activation succeeded. All required infrastructure and credentials are ready.</p>
  </div>
  <div style="margin-top: 1.5rem;">
    <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem;">Next steps</h3>
    <ul class="next-steps-list">
      <li>Return to your terminal: run <code>runharbor status</code> to inspect deployment health.</li>
      <li>Trigger a workflow run by adding a job with a <code>runs-on: [self-hosted, rh-x64-2vcpu-4gib]</code> runner label.</li>
    </ul>
  </div>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'Activation Complete',
    pageSubtitle: 'Your RunHarbor Connector is connected and ready.',
    currentStep: 3,
    content,
  });
}

export function renderActivePage(): string {
  const content = `
<section class="card">
  <div class="card-header">
    <span class="status-badge status-badge-success">Active</span>
    <h2 class="card-title" style="margin-top: 0.5rem;">Connector Active</h2>
  </div>
  <p>RunHarbor is already active. There is nothing left to set up.</p>
  <div class="callout callout-success">
    <p>Your deployment is active. Runner instances are automatically launched on demand when GitHub Actions workflows run.</p>
  </div>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'RunHarbor Status',
    pageSubtitle: 'Your connector is already active and healthy.',
    currentStep: 3,
    content,
  });
}

export function renderRetryPage(lastErrorCode?: string): string {
  const lastErrorHtml = lastErrorCode !== undefined
    ? `<div class="callout callout-error"><p>Last error: ${escapeHtml(lastErrorCode)}</p></div>`
    : '';

  const content = `
<section class="card">
  <div class="card-header">
    <span class="status-badge status-badge-warning">Activation Required</span>
    <h2 class="card-title" style="margin-top: 0.5rem;">Pending Activation</h2>
  </div>
  <p>The GitHub App is installed but RunHarbor has not been activated yet.</p>
  ${lastErrorHtml}
  <p>Click below to retry the SaaS activation using the stored GitHub App credentials and enrollment token.</p>
  <form method="post" action="/setup/retry-activate" class="setup-form">
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Retry activation</button>
    </div>
  </form>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'Retry Activation',
    pageSubtitle: 'Reconnect to SaaS to finalize connector deployment.',
    currentStep: 3,
    content,
  });
}

export function renderSecurityErrorPage(): string {
  const content = `
<section class="card">
  <div class="card-header">
    <span class="status-badge status-badge-error">Authentication Required</span>
    <h2 class="card-title" style="margin-top: 0.5rem;">Session Required</h2>
  </div>
  <p>Please return to your terminal and run runharbor setup.</p>
  <div class="callout callout-error">
    <p>Setup sessions are short-lived and authorized exclusively by your local installer keypair. Please run <code>node cli/runharbor.mjs setup</code> in your terminal to begin an authorized session.</p>
  </div>
</section>`;

  return pageShell({
    title: 'RunHarbor setup',
    pageTitle: 'Authentication Required',
    pageSubtitle: 'A valid installer session is required to access setup.',
    currentStep: 'error',
    content,
  });
}
