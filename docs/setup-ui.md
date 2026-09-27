# Connector Setup UI

This document describes the server-rendered web UI served by the customer-side RunHarbor `setup` Lambda Function URL.

## Architecture and Design Principles

The setup UI provides an accessible, self-contained browser onboarding interface without external dependencies:

- **Zero External Dependencies**: All styles are bundled as unified inline CSS. No external CDNs, scripts, web fonts, or frontend frameworks are loaded.
- **Responsive Layout**: Designed for mobile and desktop screens using modern CSS layout and system font stacks.
- **Accessible UX**: Semantic HTML elements, accessible progress stepper (`<nav aria-label="Setup Progress">`, `<ol class="stepper">`, `aria-current="step"`), WCAG 2.1 AA compliant color contrast, and visible keyboard focus outlines (`:focus-visible`).
- **Strict Security Guarantees**: No AWS credentials, private keys (App PEM), webhook secrets, or internal deployment IDs are ever echoed into HTML.

## Setup Flow & Page States

### Step 1: App Configuration (`GET /setup` and `POST /setup/begin`)
- **Organization Confirmation**: Displays the verified GitHub organization that will own the GitHub App.
- **Deterministic App Name**: Proposes a deterministic, collision-resistant App name generated as `RunHarbor (<org>)` (max 34 characters per GitHub constraints).
- **Custom App Name Override**: Provides an optional input (`app_name`) allowing customers to specify a custom App name adhering to GitHub naming constraints (1–34 characters, alphanumeric, spaces, hyphens, underscores, dots, and parentheses; "RunHarbor" is globally reserved).
- **Manifest Submission**: Submits the GitHub App manifest directly to GitHub under the verified organization settings (`https://github.com/organizations/<org>/settings/apps/new`).

### Step 2: GitHub Installation (`GET /github/app-created`)
- Following App creation, GitHub redirects back to `/github/app-created`.
- The page extracts the newly assigned App slug and directs the administrator to install the App on the organization with **All repositories** selected.
- A prominent security notice warns that personal-account or selected-repository installations will be rejected.

### Step 3: SaaS Activation & Completion (`GET /github/installed`)
- GitHub redirects back to `/github/installed` after successful installation.
- The `setup` Lambda verifies the installation, stores App credentials securely in AWS SSM Parameter Store, records the `DEPLOYMENT`, and calls RunHarbor SaaS `activate`.
- On completion, renders an operational success card confirming that RunHarbor is active and detailing next verification steps.

### Deployment Status & Retry States (`GET /setup` with existing `DEPLOYMENT`)
- **Active Deployment**: When `saasActivation.status === 'active'`, renders a status card confirming the Connector is operational, without exposing setup forms or buttons.
- **Pending or Failed Activation**: When `saasActivation.status` is `pending` or `failed`, displays an attention card showing the safe error code (e.g. `Last error: UPSTREAM_UNAVAILABLE`) and offers a **Retry activation** button (`POST /setup/retry-activate`).

### Security Error Page (Unauthenticated `GET /setup`)
- When accessed without a valid, authenticated installer session cookie (`__Host-runharbor-setup`), renders an authentication required warning instructing the administrator to return to their terminal and run `node cli/runharbor.mjs setup`.
- Prevents form rendering and prevents information leakage.
