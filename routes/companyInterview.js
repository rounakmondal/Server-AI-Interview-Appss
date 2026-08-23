import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'Ai_Interview', 'public', 'data');
const COMPANIES_MANIFEST_PATH = path.join(DATA_ROOT, 'companies-manifest.json');
const COMPANIES_INDEX_PATH = path.join(DATA_ROOT, 'companies-index.json');
const COMPANIES_SLUG_MAP_PATH = path.join(DATA_ROOT, 'companies-slug-map.json');
const COMPANY_DETAIL_DIR = path.join(DATA_ROOT, 'companies-detail');

const HUB_CATEGORY_FALLBACK = {
  consulting: 'service',
  telecom: 'product',
  manufacturing: 'service',
  retail: 'startup',
  healthcare: 'service',
  education: 'service',
  government: 'service',
  media: 'product',
  energy: 'service',
  product: 'product',
  service: 'service',
  startup: 'startup',
  finance: 'finance',
};

let companyManifestCache = null;
let companyIndexCache = null;
let companySlugMapCache = null;
const companyDetailCache = new Map();
const extendedCompanyCache = new Map();

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function loadCompanyManifest() {
  if (!companyManifestCache) companyManifestCache = await loadJson(COMPANIES_MANIFEST_PATH);
  return companyManifestCache;
}

async function loadCompanyIndex() {
  if (!companyIndexCache) companyIndexCache = await loadJson(COMPANIES_INDEX_PATH);
  return companyIndexCache;
}

async function loadCompanySlugMap() {
  if (!companySlugMapCache) companySlugMapCache = await loadJson(COMPANIES_SLUG_MAP_PATH);
  return companySlugMapCache;
}

async function loadCompanyDetailChunk(chunkIndex) {
  if (companyDetailCache.has(chunkIndex)) return companyDetailCache.get(chunkIndex);
  const data = await loadJson(path.join(COMPANY_DETAIL_DIR, `chunk-${String(chunkIndex).padStart(4, '0')}.json`));
  const map = new Map(data.map((company) => [company.slug.toLowerCase(), company]));
  companyDetailCache.set(chunkIndex, map);
  return map;
}

function normalizeHubCategory(category) {
  return String(category || '').toLowerCase().trim();
}

function getCompanyTypeByCategory(category) {
  const normalized = normalizeHubCategory(category);
  if (TYPE_FOCUS[normalized]) return normalized;
  return HUB_CATEGORY_FALLBACK[normalized] || 'service';
}

function normalizeSlugOrName(value) {
  return String(value || '').toLowerCase().trim();
}

async function resolveCompanySlug(slug) {
  const normalized = normalizeSlugOrName(slug);
  if (!normalized) return undefined;

  if (COMPANIES[normalized]) return normalized;

  const builtInSlug = Object.entries(COMPANIES).find(([, company]) => {
    return (
      normalizeSlugOrName(company.name) === normalized ||
      normalizeSlugOrName(company.shortName) === normalized
    );
  });
  if (builtInSlug) return builtInSlug[0];

  const index = await loadCompanyIndex();
  const indexMatch = index.find((entry) => {
    const entrySlug = String(entry.s).toLowerCase().trim();
    const entryName = String(entry.n).toLowerCase().trim();
    return entrySlug === normalized || entryName === normalized;
  });
  return indexMatch ? String(indexMatch.s).toLowerCase().trim() : undefined;
}

async function getExtendedCompany(slug) {
  const normalizedSlug = normalizeSlugOrName(slug);
  if (extendedCompanyCache.has(normalizedSlug)) return extendedCompanyCache.get(normalizedSlug);

  const targetSlug = await resolveCompanySlug(normalizedSlug);
  if (!targetSlug) return undefined;

  const slugMap = await loadCompanySlugMap();
  const chunkIndex = slugMap[targetSlug];
  if (chunkIndex === undefined) return undefined;

  const chunk = await loadCompanyDetailChunk(chunkIndex);
  const record = chunk.get(targetSlug);
  if (!record) return undefined;

  const company = {
    name: record.name,
    shortName: record.shortName,
    type: getCompanyTypeByCategory(record.hubCategory),
    hubCategory: record.hubCategory,
  };
  extendedCompanyCache.set(normalizedSlug, company);
  if (targetSlug !== normalizedSlug) {
    extendedCompanyCache.set(targetSlug, company);
  }
  return company;
}

// ─── Company metadata ────────────────────────────────────────────────────────
// Maps slug → { name, type } so the prompt can vary per company type.
const COMPANIES = {
  // ── Original 38 ───────────────────────────────────────────────────────────
  tcs:             { name: 'TCS',              type: 'service' },
  infosys:         { name: 'Infosys',          type: 'service' },
  wipro:           { name: 'Wipro',            type: 'service' },
  capgemini:       { name: 'Capgemini',        type: 'service' },
  accenture:       { name: 'Accenture',        type: 'service' },
  hcl:             { name: 'HCL',              type: 'service' },
  cognizant:       { name: 'Cognizant',        type: 'service' },
  'tech-mahindra': { name: 'Tech Mahindra',    type: 'service' },
  'dxc-technology':{ name: 'DXC Technology',   type: 'service' },
  'lti-mindtree':  { name: 'LTI Mindtree',    type: 'service' },
  mphasis:         { name: 'Mphasis',          type: 'service' },
  'infosys-bpm':   { name: 'Infosys BPM',     type: 'service' },
  google:          { name: 'Google',           type: 'product' },
  amazon:          { name: 'Amazon',           type: 'product' },
  microsoft:       { name: 'Microsoft',        type: 'product' },
  meta:            { name: 'Meta',             type: 'product' },
  adobe:           { name: 'Adobe',            type: 'product' },
  atlassian:       { name: 'Atlassian',        type: 'product' },
  samsung:         { name: 'Samsung',          type: 'product' },
  flipkart:        { name: 'Flipkart',         type: 'product' },
  ibm:             { name: 'IBM',              type: 'finance' },
  oracle:          { name: 'Oracle',           type: 'product' },
  deloitte:        { name: 'Deloitte',         type: 'finance' },
  'goldman-sachs': { name: 'Goldman Sachs',    type: 'finance' },
  jpmorgan:        { name: 'JPMorgan',         type: 'finance' },
  paypal:          { name: 'PayPal',           type: 'finance' },
  zoho:            { name: 'Zoho',             type: 'product' },
  swiggy:          { name: 'Swiggy',           type: 'startup' },
  zomato:          { name: 'Zomato',           type: 'startup' },
  razorpay:        { name: 'Razorpay',         type: 'startup' },
  meesho:          { name: 'Meesho',           type: 'startup' },
  phonepe:         { name: 'PhonePe',          type: 'startup' },
  cred:            { name: 'CRED',             type: 'startup' },
  ola:             { name: 'Ola',              type: 'startup' },
  paytm:           { name: 'Paytm',            type: 'startup' },
  myntra:          { name: 'Myntra',           type: 'startup' },
  juspay:          { name: 'Juspay',           type: 'startup' },
  uber:            { name: 'Uber',             type: 'startup' },

  // ── IT Services & Consulting (21) ─────────────────────────────────────────
  ey:              { name: 'EY',               type: 'service' },
  kpmg:            { name: 'KPMG',             type: 'service' },
  pwc:             { name: 'PwC',              type: 'service' },
  mckinsey:        { name: 'McKinsey',         type: 'service' },
  bcg:             { name: 'BCG',              type: 'service' },
  bain:            { name: 'Bain & Company',   type: 'service' },
  atos:            { name: 'Atos',             type: 'service' },
  'ntt-data':      { name: 'NTT Data',        type: 'service' },
  hexaware:        { name: 'Hexaware',         type: 'service' },
  persistent:      { name: 'Persistent Systems',type: 'service' },
  'larsen-toubro-infotech': { name: 'L&T Infotech', type: 'service' },
  birlasoft:       { name: 'Birlasoft',        type: 'service' },
  coforge:         { name: 'Coforge',          type: 'service' },
  zensar:          { name: 'Zensar',           type: 'service' },
  cyient:          { name: 'Cyient',           type: 'service' },
  mindtree:        { name: 'Mindtree',         type: 'service' },
  'sonata-software':{ name: 'Sonata Software', type: 'service' },
  'sopra-steria':  { name: 'Sopra Steria',    type: 'service' },
  virtusa:         { name: 'Virtusa',          type: 'service' },
  'tata-elxsi':    { name: 'Tata Elxsi',      type: 'service' },
  musigma:         { name: 'Mu Sigma',         type: 'service' },

  // ── Product / Big Tech (20) ───────────────────────────────────────────────
  apple:           { name: 'Apple',            type: 'product' },
  netflix:         { name: 'Netflix',          type: 'product' },
  salesforce:      { name: 'Salesforce',       type: 'product' },
  linkedin:        { name: 'LinkedIn',         type: 'product' },
  twitter:         { name: 'Twitter',          type: 'product' },
  spotify:         { name: 'Spotify',          type: 'product' },
  airbnb:          { name: 'Airbnb',           type: 'product' },
  snap:            { name: 'Snap',             type: 'product' },
  stripe:          { name: 'Stripe',           type: 'product' },
  shopify:         { name: 'Shopify',          type: 'product' },
  databricks:      { name: 'Databricks',       type: 'product' },
  snowflake:       { name: 'Snowflake',        type: 'product' },
  palantir:        { name: 'Palantir',         type: 'product' },
  vmware:          { name: 'VMware',           type: 'product' },
  nvidia:          { name: 'NVIDIA',           type: 'product' },
  intel:           { name: 'Intel',            type: 'product' },
  qualcomm:        { name: 'Qualcomm',         type: 'product' },
  servicenow:      { name: 'ServiceNow',       type: 'product' },
  sap:             { name: 'SAP',              type: 'product' },
  'uber-india':    { name: 'Uber India',       type: 'startup' },

  // ── Indian Startups & Unicorns (27) ───────────────────────────────────────
  dream11:         { name: 'Dream11',          type: 'startup' },
  groww:           { name: 'Groww',            type: 'startup' },
  zerodha:         { name: 'Zerodha',          type: 'startup' },
  byju:            { name: "BYJU'S",           type: 'startup' },
  unacademy:       { name: 'Unacademy',        type: 'startup' },
  nykaa:           { name: 'Nykaa',            type: 'startup' },
  lenskart:        { name: 'Lenskart',         type: 'startup' },
  freshworks:      { name: 'Freshworks',       type: 'product' },
  'ola-electric':  { name: 'Ola Electric',     type: 'startup' },
  sharechat:       { name: 'ShareChat',        type: 'startup' },
  bigbasket:       { name: 'BigBasket',        type: 'startup' },
  dunzo:           { name: 'Dunzo',            type: 'startup' },
  'cure-fit':      { name: 'Cure.fit',         type: 'startup' },
  upstox:          { name: 'Upstox',           type: 'startup' },
  'urban-company': { name: 'Urban Company',    type: 'startup' },
  rapido:          { name: 'Rapido',           type: 'startup' },
  delhivery:       { name: 'Delhivery',        type: 'startup' },
  policybazaar:    { name: 'PolicyBazaar',     type: 'startup' },
  cars24:          { name: 'Cars24',           type: 'startup' },
  spinny:          { name: 'Spinny',           type: 'startup' },
  jupiter:         { name: 'Jupiter',          type: 'startup' },
  slice:           { name: 'Slice',            type: 'startup' },
  mmt:             { name: 'MakeMyTrip',       type: 'startup' },
  oyo:             { name: 'OYO',              type: 'startup' },
  blinkit:         { name: 'Blinkit',          type: 'startup' },
  zepto:           { name: 'Zepto',            type: 'startup' },
  inmobi:          { name: 'InMobi',           type: 'startup' },
  practo:          { name: 'Practo',           type: 'startup' },

  // ── Banking & Finance (10) ────────────────────────────────────────────────
  hsbc:            { name: 'HSBC',             type: 'finance' },
  barclays:        { name: 'Barclays',         type: 'finance' },
  'morgan-stanley':{ name: 'Morgan Stanley',   type: 'finance' },
  'deutsche-bank': { name: 'Deutsche Bank',    type: 'finance' },
  citi:            { name: 'Citi',             type: 'finance' },
  ubs:             { name: 'UBS',              type: 'finance' },
  mastercard:      { name: 'Mastercard',       type: 'finance' },
  visa:            { name: 'Visa',             type: 'finance' },
  'american-express':{ name: 'American Express',type: 'finance' },
  'bajaj-finserv': { name: 'Bajaj Finserv',   type: 'finance' },

  // ── Telecom & E-commerce (6) ──────────────────────────────────────────────
  'reliance-jio':  { name: 'Reliance Jio',    type: 'product' },
  'bharti-airtel': { name: 'Bharti Airtel',    type: 'product' },
  hotstar:         { name: 'Hotstar',          type: 'product' },
  'media-net':     { name: 'Media.net',        type: 'product' },
  ajio:            { name: 'AJIO',             type: 'startup' },
  tatacliq:        { name: 'Tata CLiQ',        type: 'startup' },

  // ── Semiconductor, Hardware & Cloud (9) ───────────────────────────────────
  amd:             { name: 'AMD',              type: 'product' },
  'texas-instruments':{ name: 'Texas Instruments',type: 'product' },
  cisco:           { name: 'Cisco',            type: 'product' },
  juniper:         { name: 'Juniper Networks', type: 'product' },
  aws:             { name: 'AWS',              type: 'product' },
  gcp:             { name: 'Google Cloud',     type: 'product' },
  dell:            { name: 'Dell',             type: 'product' },
  hp:              { name: 'HP',               type: 'product' },
  micron:          { name: 'Micron',           type: 'product' },

  // ── Automotive & Manufacturing (5) ────────────────────────────────────────
  bosch:           { name: 'Bosch',            type: 'product' },
  siemens:         { name: 'Siemens',          type: 'product' },
  continental:     { name: 'Continental',       type: 'product' },
  mahindra:        { name: 'Mahindra',         type: 'product' },
  'schneider-electric':{ name: 'Schneider Electric',type: 'product' },

  // ── Healthcare (3) ────────────────────────────────────────────────────────
  philips:         { name: 'Philips',          type: 'product' },
  'ge-healthcare': { name: 'GE Healthcare',    type: 'product' },
  medtronic:       { name: 'Medtronic',        type: 'product' },

  // ── Global Tech & SaaS (20) ──────────────────────────────────────────────
  twilio:          { name: 'Twilio',           type: 'product' },
  okta:            { name: 'Okta',             type: 'product' },
  'palo-alto-networks':{ name: 'Palo Alto Networks',type: 'product' },
  crowdstrike:     { name: 'CrowdStrike',      type: 'product' },
  mongodb:         { name: 'MongoDB',          type: 'product' },
  elastic:         { name: 'Elastic',          type: 'product' },
  confluent:       { name: 'Confluent',        type: 'product' },
  hashicorp:       { name: 'HashiCorp',        type: 'product' },
  cloudflare:      { name: 'Cloudflare',       type: 'product' },
  github:          { name: 'GitHub',           type: 'product' },
  gitlab:          { name: 'GitLab',           type: 'product' },
  figma:           { name: 'Figma',            type: 'product' },
  canva:           { name: 'Canva',            type: 'product' },
  notion:          { name: 'Notion',           type: 'product' },
  datadog:         { name: 'Datadog',          type: 'product' },
  splunk:          { name: 'Splunk',           type: 'product' },
  workday:         { name: 'Workday',          type: 'product' },
  openai:          { name: 'OpenAI',           type: 'product' },
  anthropic:       { name: 'Anthropic',        type: 'product' },

  // ── More Indian IT & Product (21) ─────────────────────────────────────────
  'search-india':  { name: 'Google India',     type: 'product' },
  'microsoft-india':{ name: 'Microsoft India', type: 'product' },
  thoughtworks:    { name: 'ThoughtWorks',     type: 'service' },
  hashedin:        { name: 'HashedIn',         type: 'service' },
  nagarro:         { name: 'Nagarro',          type: 'service' },
  'publicis-sapient':{ name: 'Publicis Sapient',type: 'service' },
  epam:            { name: 'EPAM Systems',     type: 'service' },
  thoughtspot:     { name: 'ThoughtSpot',      type: 'product' },
  commvault:       { name: 'Commvault',        type: 'product' },
  sprinklr:        { name: 'Sprinklr',         type: 'product' },
  postman:         { name: 'Postman',          type: 'product' },
  browserstack:    { name: 'BrowserStack',     type: 'product' },
  druva:           { name: 'Druva',            type: 'product' },
  harness:         { name: 'Harness',          type: 'product' },
  chargebee:       { name: 'Chargebee',        type: 'product' },
  clevertap:       { name: 'CleverTap',        type: 'product' },
  moengage:        { name: 'MoEngage',         type: 'product' },
  'yellow-ai':     { name: 'Yellow.ai',        type: 'product' },
  darwinbox:       { name: 'Darwinbox',        type: 'startup' },
  whatfix:         { name: 'Whatfix',           type: 'product' },
  hasura:          { name: 'Hasura',           type: 'product' },

  // ── Final batch (20) ─────────────────────────────────────────────────────
  vercel:          { name: 'Vercel',           type: 'product' },
  supabase:        { name: 'Supabase',         type: 'product' },
  render:          { name: 'Render',           type: 'product' },
  'razorpay-x':    { name: 'Razorpay X',      type: 'startup' },
  'pine-labs':     { name: 'Pine Labs',        type: 'startup' },
  'cred-club':     { name: 'CRED Club',        type: 'startup' },
  'walmart-labs':  { name: 'Walmart Labs',     type: 'product' },
  expedia:         { name: 'Expedia',          type: 'product' },
  booking:         { name: 'Booking.com',      type: 'product' },
  grab:            { name: 'Grab',             type: 'startup' },
  gojek:           { name: 'Gojek',            type: 'startup' },
  'samsung-rd':    { name: 'Samsung R&D',      type: 'product' },
  directi:         { name: 'Directi',          type: 'product' },
  'zeta-suite':    { name: 'Zeta',             type: 'startup' },
  'k2-pure':       { name: 'K2 Pure Solutions', type: 'product' },
  quora:           { name: 'Quora',            type: 'product' },
  nutanix:         { name: 'Nutanix',          type: 'product' },
  rubrik:          { name: 'Rubrik',           type: 'product' },
  cohesity:        { name: 'Cohesity',         type: 'product' },
  'tower-research':{ name: 'Tower Research',   type: 'finance' },
};

// Category focus per company type
const TYPE_FOCUS = {
  service: 'Aptitude, Basic Coding (Java/Python/C), DBMS, OS, Networking, HR, Verbal, Logical Reasoning, Managerial',
  product: 'DSA, System Design, Behavioral/Leadership, Coding Problems, OS, DBMS, Networking, HR',
  startup: 'Machine Coding, System Design, DSA, Culture Fit, Problem Solving, Behavioral, HR',
  finance: 'Problem Solving, DSA, Domain Knowledge (Finance/Banking), Behavioral, SQL/Database, HR',
};

// ─── In-memory cache (slug → { data, timestamp }) ───────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Groq helper ─────────────────────────────────────────────────────────────
const GROQ_MODELS = [
  process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

const MODEL_TOKEN_CAPS = {
  'llama-3.1-8b-instant': 4000,
  'openai/gpt-oss-120b':     4000,
  'openai/gpt-oss-20b':      4000,
  'llama-3.1-8b-instant':    4000,
};

async function callGroq(systemPrompt, userPrompt, maxTokens = 8000) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  for (const model of GROQ_MODELS) {
    const effectiveTokens = Math.min(maxTokens, MODEL_TOKEN_CAPS[model] ?? 4000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000); // 60s for large response

    try {
      const { callLLMWithFallback, convertGeminiToOpenAI } = await import('../utils/llmFallback.js');
      
      const res = await callLLMWithFallback(
        apiKey,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        {
          model,
          temperature: 0.7,
          max_tokens: effectiveTokens,
          top_p: 0.9
        },
        controller.signal,
        'company-interview'
      );
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[company-interview] model ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
        continue;
      }

      const data    = await res.json();
      // Handle Gemini response format (different from OpenAI)
      const finalData = data.candidates ? convertGeminiToOpenAI(data) : data;
      const content = finalData.choices?.[0]?.message?.content?.trim();
      if (!content) { console.warn(`[company-interview] model ${model} empty content`); continue; }

      console.log(`[company-interview] success with ${model}`);
      return content;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[company-interview] model ${model} error:`, err.message);
    }
  }
  throw new Error('All Groq models failed');
}

// ─── JSON extraction ─────────────────────────────────────────────────────────
function extractJSON(text) {
  try {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    if (start === -1) return null;

    let depth = 0, inString = false, escapeNext = false, end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escapeNext)    { escapeNext = false; continue; }
      if (ch === '\\')   { escapeNext = true;  continue; }
      if (ch === '"')    { inString = !inString; continue; }
      if (!inString) {
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
    }

    if (end !== -1) return JSON.parse(cleaned.substring(start, end));

    // Truncated — try repair
    const partial = cleaned.substring(start);
    const stack = [];
    inString = false; escapeNext = false;
    let lastComma = -1;
    for (let i = 0; i < partial.length; i++) {
      const ch = partial[i];
      if (escapeNext)   { escapeNext = false; continue; }
      if (ch === '\\')  { escapeNext = true;  continue; }
      if (ch === '"')   { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
      else if (ch === ',' && stack.length === 1) lastComma = i;
    }

    let safe = lastComma > 0 ? partial.substring(0, lastComma) : partial;
    const closings = stack.reverse().map(c => c === '{' ? '}' : ']').join('');
    return JSON.parse(safe + closings);
  } catch {
    return null;
  }
}

// ─── Build prompt (for a chunk of questions) ────────────────────────────────
function buildChunkPrompt(companyName, companyType, chunkNum, totalChunks) {
  const focus = TYPE_FOCUS[companyType] || TYPE_FOCUS.service;
  const categories = focus.split(', ');

  // Rotate categories per chunk so each chunk covers different areas
  const chunkSize = Math.ceil(categories.length / totalChunks);
  const chunkCategories = categories.slice(chunkNum * chunkSize, (chunkNum + 1) * chunkSize);
  const focusStr = chunkCategories.length > 0 ? chunkCategories.join(', ') : focus;

  const systemPrompt = `You are an expert interview coach. Generate REAL interview questions for ${companyName}. Output ONLY a valid JSON array.`;

  const userPrompt = `Generate exactly 10 interview questions for ${companyName} (${companyType} company).

Categories to cover: ${focusStr}

JSON format — each object:
{"id":1,"question":"...","answer":"...","category":"...","difficulty":"Easy|Medium|Hard","tags":["..."]}

Rules:
- REAL questions asked at ${companyName}
- difficulty: "Easy", "Medium", or "Hard"
- answer: 2-4 sentences
- tags: lowercase keywords
- Output ONLY a JSON array. No markdown, no explanation.`;

  return { systemPrompt, userPrompt };
}

// ─── Fetch questions in chunks with concurrency control and progressive sending ─────────────────────────────────────
async function generateQuestionsInChunks(companyName, companyType, onBatchComplete = null) {
  const TOTAL_CHUNKS = 5; // More smaller batches for better progressive loading
  const CONCURRENCY_LIMIT = 3; // Allow 3 concurrent API calls
  const limit = pLimit(CONCURRENCY_LIMIT);
  const allQuestions = [];

  // Create batch promises with concurrency control
  const batchPromises = Array.from({ length: TOTAL_CHUNKS }, async (_, i) => {
    return limit(async () => {
      console.log(`[company-interview] fetching chunk ${i + 1}/${TOTAL_CHUNKS} for "${companyName}"`);
      const { systemPrompt, userPrompt } = buildChunkPrompt(companyName, companyType, i, TOTAL_CHUNKS);

      try {
        const raw = await callGroq(systemPrompt, userPrompt, 4000);
        const parsed = extractJSON(raw);

        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          allQuestions.push(...parsed);
          console.log(`[company-interview] chunk ${i + 1} got ${parsed.length} questions`);

          // Call callback for progressive sending if provided
          if (onBatchComplete) {
            await onBatchComplete(parsed, i + 1, TOTAL_CHUNKS);
          }

          return parsed;
        } else {
          console.warn(`[company-interview] chunk ${i + 1} parse failed, skipping`);
          return [];
        }
      } catch (err) {
        console.warn(`[company-interview] chunk ${i + 1} error: ${err.message}`);
        return [];
      }
    });
  });

  // Wait for all batches to complete
  await Promise.all(batchPromises);

  return allQuestions;
}

// ─── Endpoint: GET /api/company-interviews — list all companies ──────────────
router.get('/', async (req, res) => {
  try {
    const manifest = await loadCompanyManifest();
    const extended = await loadCompanyIndex();
    const companyMap = new Map(
      Object.entries(COMPANIES).map(([slug, { name, type }]) => [slug, { slug, name, type }]),
    );

    for (const entry of extended) {
      const slug = String(entry.s).toLowerCase();
      if (!companyMap.has(slug)) {
        companyMap.set(slug, {
          slug,
          name: entry.n,
          type: getCompanyTypeByCategory(entry.cat),
        });
      }
    }

    const companies = [...companyMap.values()];
    return res.json({ success: true, total: manifest?.total ?? companies.length, companies });
  } catch (err) {
    console.error('[company-interview] list load failed', err);
    return res.status(500).json({ success: false, error: 'Failed to load company list' });
  }
});

  // ─── Endpoint: GET /api/company-interviews/seo/:slug — SEO JSON for crawlers/prerender ─
  router.get('/seo/:slug', async (req, res) => {
    try {
      const requested = req.params.slug;
      const resolvedSlug = await resolveCompanySlug(requested);
      if (!resolvedSlug) return res.status(404).json({ success: false, error: 'Company not found' });

      let company = COMPANIES[resolvedSlug];
      if (!company) {
        company = await getExtendedCompany(resolvedSlug);
        if (!company) return res.status(404).json({ success: false, error: 'Company not found' });
      }

      const SITE = process.env.SITE || 'https://medhahub.in';
      const title = (company.seo && company.seo.title) || `${company.shortName || company.name} Interview Questions & Answers 2026 | MedhaHub`;
      const description = (company.seo && company.seo.description) || `${company.name} interview questions, interview process, and expert answers. Prepare for ${company.shortName || company.name} interviews in 2026 with technical, behavioral, and system design practice.`;
      const keywords = (company.seo && company.seo.keywords) || `${(company.shortName || company.name)} interview questions, ${company.shortName || company.name} interview`;
      const canonical = `${SITE}/interview-questions/${resolvedSlug}`;

      return res.json({
        success: true,
        slug: resolvedSlug,
        seo: { title, description, keywords, canonical },
        company: {
          name: company.name,
          shortName: company.shortName,
          hubCategory: company.hubCategory || company.type || null,
          interviewRounds: company.interviewRounds || [],
          founded: company.founded || null,
          headquarters: company.headquarters || null,
          employees: company.employees || null,
          avgPackage: company.avgPackage || null,
        },
      });
    } catch (err) {
      console.error('[company-interview] seo lookup failed', err);
      return res.status(500).json({ success: false, error: 'Failed to resolve SEO' });
    }
  });

// ─── Endpoint: GET /api/company-interviews/:slug ─────────────────────────────
router.get('/:slug', async (req, res) => {
  const requested = req.params.slug;
  const resolvedSlug = await resolveCompanySlug(requested);
  if (!resolvedSlug) {
    return res.status(404).json({ success: false, error: 'Company not found' });
  }

  let company = COMPANIES[resolvedSlug];
  if (!company) {
    company = await getExtendedCompany(resolvedSlug);
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
  }

  // Check cache first
  const cached = cache.get(resolvedSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[company-interview] cache hit for "${resolvedSlug}"`);
    return res.json(cached.data);
  }

  // Set up Server-Sent Events for progressive response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  let isFirstBatch = true;
  let allQuestions = [];
  let batchCount = 0;
  const TOTAL_BATCHES = 5;

  try {
    // Callback function to send batches progressively
    const sendBatch = async (batchQuestions, batchIndex, totalBatches) => {
      if (batchQuestions.length === 0) return;

      // Normalize questions
      const normalizedBatch = batchQuestions.map((q, i) => ({
        id: allQuestions.length + i + 1,
        question: q.question || '',
        answer: q.answer || '',
        category: q.category || 'General',
        difficulty: ['Easy', 'Medium', 'Hard'].includes(q.difficulty) ? q.difficulty : 'Medium',
        tags: Array.isArray(q.tags) ? q.tags.map(t => String(t).toLowerCase()) : [],
      }));

      allQuestions.push(...normalizedBatch);
      batchCount++;

      const batchData = {
        success: true,
        company: resolvedSlug,
        batch: batchIndex,
        totalBatches,
        batchQuestions: normalizedBatch,
        totalQuestionsSoFar: allQuestions.length,
        isComplete: batchCount >= totalBatches
      };

      // Send batch via SSE
      res.write(`data: ${JSON.stringify(batchData)}\n\n`);

      // If this is the first batch, send it immediately without waiting
      if (isFirstBatch) {
        isFirstBatch = false;
        console.log(`[company-interview] first batch sent for "${resolvedSlug}" — ${normalizedBatch.length} questions`);
      } else {
        console.log(`[company-interview] batch ${batchIndex} sent for "${resolvedSlug}" — ${normalizedBatch.length} questions`);
      }
    };

    // Generate questions with progressive sending
    await generateQuestionsInChunks(company.name, company.type, sendBatch);

    if (allQuestions.length === 0) {
      console.error('[company-interview] All batches failed for', resolvedSlug);
      res.write(`data: ${JSON.stringify({ success: false, error: 'Failed to generate questions' })}\n\n`);
      return res.end();
    }

    // Send completion event
    const categories = [...new Set(allQuestions.map(q => q.category))];
    const finalData = {
      success: true,
      company: resolvedSlug,
      totalQuestions: allQuestions.length,
      categories,
      questions: allQuestions,
      complete: true
    };

    res.write(`data: ${JSON.stringify(finalData)}\n\n`);

    // Cache the final result
    cache.set(resolvedSlug, { data: finalData, timestamp: Date.now() });

    console.log(`[company-interview] completed for "${resolvedSlug}" — ${allQuestions.length} total questions`);
    res.end();

  } catch (err) {
    console.error(`[company-interview] Error for "${resolvedSlug}":`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate interview questions' });
    } else {
      res.write(`data: ${JSON.stringify({ success: false, error: err.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
