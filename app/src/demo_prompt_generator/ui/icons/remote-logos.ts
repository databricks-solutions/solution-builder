/**
 * remote-logos — partner/product logos referenced from public CDNs instead of
 * self-hosted SVG files. Two reasons a logo lives here rather than on disk:
 *   1. Trademarked marks (Snowflake, Salesforce, …) — legal asked us not to
 *      serve the bytes; an off-our-server URL resolves it.
 *   2. Extra data/AI/dev logos we want available without bloating the repo.
 *
 * OSS logos (Apache*, Postgres, Redis, …) and cloud marks stay local under
 * ui/icons/. Every URL was curl-verified (HTTP 200 + SVG body), full-color.
 *
 * Sources: cdn.svglogos.dev (bulk, full-color), vectorlogo.zone, Wikimedia
 * Commons, worldvectorlogo. file-icons.tsx merges these into FILE_ICONS so
 * the `file:vendor/<name>` keys keep working — only the byte source changed.
 */
export const REMOTE_VENDOR_LOGOS: Record<string, string> = {
  adyen: "https://cdn.svglogos.dev/logos/adyen.svg",
  airtable: "https://cdn.svglogos.dev/logos/airtable.svg",
  amplitude: "https://cdn.svglogos.dev/logos/amplitude-icon.svg",
  anthropic: "https://cdn.svglogos.dev/logos/anthropic-icon.svg",
  atlassian: "https://cdn.svglogos.dev/logos/atlassian.svg",
  bigcommerce: "https://www.vectorlogo.zone/logos/bigcommerce/bigcommerce-icon.svg",
  box: "https://cdn.svglogos.dev/logos/box.svg",
  braze: "https://cdn.svglogos.dev/logos/braze-icon.svg",
  brevo: "https://cdn.worldvectorlogo.com/logos/brevo.svg",
  confluence: "https://cdn.svglogos.dev/logos/confluence.svg",
  dropbox: "https://cdn.svglogos.dev/logos/dropbox.svg",
  gemini: "https://cdn.svglogos.dev/logos/google-gemini.svg",
  github: "https://cdn.svglogos.dev/logos/github-icon.svg",
  gitlab: "https://cdn.svglogos.dev/logos/gitlab-icon.svg",
  glean: "https://upload.wikimedia.org/wikipedia/commons/f/f4/Glean_logo.svg",
  "google-ads": "https://cdn.svglogos.dev/logos/google-ads.svg",
  "google-analytics": "https://cdn.svglogos.dev/logos/google-analytics.svg",
  "google-docs": "https://upload.wikimedia.org/wikipedia/commons/0/01/Google_Docs_logo_%282014-2020%29.svg",
  "google-drive": "https://cdn.svglogos.dev/logos/google-drive.svg",
  "google-sheets": "https://upload.wikimedia.org/wikipedia/commons/3/30/Google_Sheets_logo_%282014-2020%29.svg",
  hootsuite: "https://cdn.svglogos.dev/logos/hootsuite-icon.svg",
  hubspot: "https://cdn.svglogos.dev/logos/hubspot.svg",
  ibm: "https://cdn.svglogos.dev/logos/ibm.svg",
  informatica: "https://www.vectorlogo.zone/logos/informatica/informatica-icon.svg",
  intercom: "https://cdn.svglogos.dev/logos/intercom-icon.svg",
  jira: "https://cdn.svglogos.dev/logos/jira.svg",
  klarna: "https://www.vectorlogo.zone/logos/klarna/klarna-icon.svg",
  looker: "https://cdn.svglogos.dev/logos/looker-icon.svg",
  mailchimp: "https://cdn.svglogos.dev/logos/mailchimp.svg",
  marketo: "https://www.vectorlogo.zone/logos/marketo/marketo-icon.svg",
  mastercard: "https://cdn.svglogos.dev/logos/mastercard.svg",
  meta: "https://cdn.svglogos.dev/logos/meta-icon.svg",
  microsoft: "https://cdn.svglogos.dev/logos/microsoft-icon.svg",
  "microsoft-sql-server": "https://upload.wikimedia.org/wikipedia/commons/4/41/Microsoft_SQL_Server_2025_icon.svg",
  mixpanel: "https://cdn.svglogos.dev/logos/mixpanel.svg",
  notion: "https://cdn.svglogos.dev/logos/notion-icon.svg",
  openai: "https://cdn.svglogos.dev/logos/openai-icon.svg",
  oracle: "https://cdn.svglogos.dev/logos/oracle.svg",
  paypal: "https://cdn.svglogos.dev/logos/paypal.svg",
  planetscale: "https://cdn.svglogos.dev/logos/planetscale.svg",
  "power-bi": "https://cdn.svglogos.dev/logos/microsoft-power-bi.svg",
  prestashop: "https://cdn.svglogos.dev/logos/prestashop-icon.svg",
  qlik: "https://cdn.svglogos.dev/logos/qlik.svg",
  quickbooks: "https://upload.wikimedia.org/wikipedia/commons/7/79/Intuit_QuickBooks_logo.svg",
  salesforce: "https://cdn.svglogos.dev/logos/salesforce.svg",
  sap: "https://cdn.svglogos.dev/logos/sap.svg",
  segment: "https://cdn.svglogos.dev/logos/segment-icon.svg",
  sendgrid: "https://cdn.svglogos.dev/logos/sendgrid-icon.svg",
  shopify: "https://cdn.svglogos.dev/logos/shopify.svg",
  shopware: "https://upload.wikimedia.org/wikipedia/commons/8/80/Shopware_Logo_2016.svg",
  siemens: "https://www.vectorlogo.zone/logos/siemens/siemens-icon.svg",
  singlestore: "https://cdn.svglogos.dev/logos/singlestore-icon.svg",
  slack: "https://cdn.svglogos.dev/logos/slack-icon.svg",
  snapchat: "https://www.vectorlogo.zone/logos/snapchat/snapchat-icon.svg",
  snowflake: "https://cdn.svglogos.dev/logos/snowflake-icon.svg",
  square: "https://cdn.svglogos.dev/logos/square.svg",
  stripe: "https://cdn.svglogos.dev/logos/stripe.svg",
  supabase: "https://cdn.svglogos.dev/logos/supabase-icon.svg",
  tableau: "https://cdn.svglogos.dev/logos/tableau-icon.svg",
  talend: "https://www.vectorlogo.zone/logos/talend/talend-icon.svg",
  teradata: "https://upload.wikimedia.org/wikipedia/commons/a/af/Teradata_logo.svg",
  tiktok: "https://cdn.svglogos.dev/logos/tiktok-icon.svg",
  twilio: "https://cdn.svglogos.dev/logos/twilio-icon.svg",
  visa: "https://cdn.svglogos.dev/logos/visa.svg",
  woocommerce: "https://cdn.svglogos.dev/logos/woocommerce-icon.svg",
  xero: "https://cdn.svglogos.dev/logos/xero.svg",
  youtube: "https://cdn.svglogos.dev/logos/youtube-icon.svg",
  zapier: "https://cdn.svglogos.dev/logos/zapier.svg",
  zendesk: "https://cdn.svglogos.dev/logos/zendesk-icon.svg",
  zoho: "https://cdn.svglogos.dev/logos/zoho.svg",

  // ── Data / AI / dev-tool logos (not trademark-driven — just useful) ──────
  // All verified 200 + SVG on cdn.svglogos.dev. `-icon` variant preferred for
  // brands that have one (square/compact, better as a diagram tile).
  // AI / LLM:
  mcp: "https://cdn.svglogos.dev/logos/model-context-protocol-icon.svg",
  "hugging-face": "https://cdn.svglogos.dev/logos/hugging-face-icon.svg",
  mistral: "https://cdn.svglogos.dev/logos/mistral-ai-icon.svg",
  perplexity: "https://cdn.svglogos.dev/logos/perplexity-icon.svg",
  pinecone: "https://cdn.svglogos.dev/logos/pinecone-icon.svg",
  chroma: "https://cdn.svglogos.dev/logos/chroma.svg",
  qdrant: "https://cdn.svglogos.dev/logos/qdrant-icon.svg",
  milvus: "https://cdn.svglogos.dev/logos/milvus-icon.svg",
  // Dev / deploy / runtime:
  vercel: "https://cdn.svglogos.dev/logos/vercel-icon.svg",
  netlify: "https://cdn.svglogos.dev/logos/netlify-icon.svg",
  cloudflare: "https://cdn.svglogos.dev/logos/cloudflare-icon.svg",
  docker: "https://cdn.svglogos.dev/logos/docker-icon.svg",
  kubernetes: "https://cdn.svglogos.dev/logos/kubernetes.svg",
  terraform: "https://cdn.svglogos.dev/logos/terraform-icon.svg",
  fastapi: "https://cdn.svglogos.dev/logos/fastapi-icon.svg",
  react: "https://cdn.svglogos.dev/logos/react.svg",
  nextjs: "https://cdn.svglogos.dev/logos/nextjs-icon.svg",
  nodejs: "https://cdn.svglogos.dev/logos/nodejs-icon.svg",
  python: "https://cdn.svglogos.dev/logos/python.svg",
  streamlit: "https://cdn.svglogos.dev/logos/streamlit.svg",
  gradio: "https://cdn.svglogos.dev/logos/gradio-icon.svg",
  // Data warehouse:
  "aws-redshift": "https://cdn.svglogos.dev/logos/aws-redshift.svg",
};

// Trademarked partner logos (70) + data/AI/dev logos, all referenced remotely.
