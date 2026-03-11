import { listWorkingTreeFiles, readWorkingTreeFile } from '../git.js';
import type { TopologyEdge } from './types.js';

/**
 * Lib path prefixes where .ex files are expected.
 */
const LIB_PATH_PATTERNS = [
  /^lib\//,
  /^src\/lib\//,
  /^apps\/[^/]+\/lib\//,
  /^src\/apps\/[^/]+\/lib\//,
];

/**
 * Known external domains to filter out.
 * These are third-party APIs, NOT inter-service communication.
 */
const EXTERNAL_DOMAINS = [
  'google.com',
  'googleapis.com',
  'openai.com',
  'adyen.com',
  'stripe.com',
  'twilio.com',
  'sendgrid.com',
  'sendgrid.net',
  'amazonaws.com',
  'github.com',
  'slack.com',
  'facebook.com',
  'twitter.com',
  'braintreegateway.com',
  'paypal.com',
  'mailgun.net',
  'mailchimp.com',
  'sentry.io',
  'datadoghq.com',
  'newrelic.com',
  'pagerduty.com',
  'auth0.com',
  'okta.com',
  'intercom.io',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'cloudflare.com',
  'heroku.com',
  'vercel.com',
  'netlify.com',
  'firebase.com',
  'firebaseio.com',
  'apple.com',
  'microsoft.com',
  'zoom.us',
];

/** Tesla.Middleware.BaseUrl pattern */
const TESLA_BASEURL_RE = /plug\s+Tesla\.Middleware\.BaseUrl,\s*"([^"]+)"/g;

/** Module-level @base_url attribute */
const BASE_URL_ATTR_RE = /@base_url\s+"([^"]+)"/g;

/**
 * Check if a URL points to a known external service.
 */
function isExternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return EXTERNAL_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    // Malformed URL — skip it
    return true;
  }
}

/**
 * Extract a target service name from a URL's hostname.
 * e.g., "https://some-service.internal" -> "some-service"
 */
function extractServiceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Take the first subdomain segment as service name
    const parts = hostname.split('.');
    return parts[0] ?? hostname;
  } catch {
    return url;
  }
}

/**
 * Check if a file path is under a test/spec directory or is a test file.
 */
function isTestPath(filePath: string): boolean {
  return (
    /(?:^|\/)test\//.test(filePath) ||
    /(?:^|\/)spec\//.test(filePath) ||
    filePath.endsWith('_test.exs') ||
    filePath.endsWith('_test.ex')
  );
}

/**
 * Extract HTTP client edges from an Elixir repo.
 *
 * Detects Tesla.Middleware.BaseUrl and @base_url patterns.
 * Filters out known external domains (Google, OpenAI, Stripe, etc.).
 * All HTTP edges have confidence "low" per research findings.
 *
 * Returns TopologyEdge[] — pure data, no DB access.
 */
export function extractHttpClientEdges(
  repoPath: string,
  fileList?: string[],
): TopologyEdge[] {
  const allFiles = Array.isArray(fileList) ? fileList : listWorkingTreeFiles(repoPath);
  const exFiles = allFiles.filter(
    (f) => f.endsWith('.ex') && LIB_PATH_PATTERNS.some((p) => p.test(f)) && !isTestPath(f),
  );

  const edges: TopologyEdge[] = [];

  for (const filePath of exFiles) {
    const content = readWorkingTreeFile(repoPath, filePath);
    if (!content) continue;

    // Pattern 1: Tesla.Middleware.BaseUrl
    TESLA_BASEURL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TESLA_BASEURL_RE.exec(content)) !== null) {
      const url = match[1]!;
      if (isExternalUrl(url)) continue;

      edges.push({
        mechanism: 'http',
        sourceFile: filePath,
        targetServiceName: extractServiceFromUrl(url),
        metadata: { url },
        confidence: 'low',
      });
    }

    // Pattern 2: @base_url module attribute
    BASE_URL_ATTR_RE.lastIndex = 0;
    while ((match = BASE_URL_ATTR_RE.exec(content)) !== null) {
      const url = match[1]!;
      if (isExternalUrl(url)) continue;

      edges.push({
        mechanism: 'http',
        sourceFile: filePath,
        targetServiceName: extractServiceFromUrl(url),
        metadata: { url },
        confidence: 'low',
      });
    }
  }

  return edges;
}
