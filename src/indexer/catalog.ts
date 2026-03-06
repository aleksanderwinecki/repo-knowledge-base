import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Parse YAML frontmatter from MDX file content.
 * Simple line-by-line parser for flat YAML (no deep nesting).
 * Handles: scalar values, quoted values, arrays with `- item` syntax.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  let currentKey = '';
  for (const line of yaml.split('\n')) {
    // Match key: value pairs (key must start at beginning of line)
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)?$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawValue = kvMatch[2]?.trim();

      if (rawValue && rawValue !== '>-') {
        // Scalar value -- strip surrounding quotes
        result[currentKey] = rawValue.replace(/^['"]|['"]$/g, '');
      } else {
        // No value or multi-line indicator -> could be array or multi-line string
        result[currentKey] = [];
      }
    } else if (/^\s+-\s+/.test(line) && currentKey) {
      // Array item: "  - value" or "  - id: 'something'"
      const itemMatch = line.match(/^\s+-\s+(.+)/);
      if (itemMatch) {
        const item = itemMatch[1].trim().replace(/^['"]|['"]$/g, '');
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }
        (result[currentKey] as string[]).push(item);
      }
    }
    // Skip continuation lines for multi-line scalars (>-) -- we don't need them
  }

  return result;
}

/**
 * Convert a catalog event ID to matching patterns.
 * "event:payment-failed" -> { camelCase: "PaymentFailed", snakeCase: "payment_failed" }
 */
export function catalogIdToMatchers(catalogId: string): { camelCase: string; snakeCase: string } {
  // Strip "event:" prefix
  const slug = catalogId.replace(/^event:/, '');

  // kebab to CamelCase: "payment-failed" -> "PaymentFailed"
  const camelCase = slug
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  // kebab to snake_case: "payment-failed" -> "payment_failed"
  const snakeCase = slug.replace(/-/g, '_');

  return { camelCase, snakeCase };
}

/** Catalog event info after parsing */
interface CatalogEvent {
  id: string;
  owners: string[];
}

/** Domain info: name -> service IDs */
interface DomainInfo {
  name: string;
  serviceIds: string[];
}

/** Service info: id -> event IDs it sends */
interface ServiceInfo {
  eventIds: string[];
}

/**
 * Enrich existing KB events with Event Catalog metadata.
 * Auto-discovers fresha-event-catalog directory under rootDir.
 *
 * Phases:
 * 1. Parse domain MDX -> domain name + service IDs
 * 2. Parse service MDX -> service ID + event IDs (sends)
 * 3. Build eventId -> domainName lookup via inversion
 * 4. Parse event MDX -> event ID + owners
 * 5. Match catalog events to KB events (multi-strategy)
 * 6. UPDATE matched events with domain/owner_team
 */
export function enrichFromEventCatalog(
  db: Database.Database,
  rootDir: string,
): { matched: number; skipped: number } {
  // Auto-discover the event catalog directory
  const catalogSrc = findCatalogSrc(rootDir);
  if (!catalogSrc) {
    return { matched: 0, skipped: 0 };
  }

  // Phase 1: Parse domain MDX files
  const domains = parseDomains(catalogSrc);

  // Phase 2: Parse service MDX files
  const services = parseServices(catalogSrc);

  // Phase 3: Build eventId -> domainName lookup
  const eventToDomain = buildEventDomainMap(domains, services);

  // Phase 4: Parse event MDX files
  const catalogEvents = parseCatalogEvents(catalogSrc);

  // Phase 5 & 6: Match and update
  let matched = 0;
  let skipped = 0;

  const updateEvent = db.prepare(
    'UPDATE events SET domain = ?, owner_team = ? WHERE id = ?',
  );

  const txn = db.transaction(() => {
    for (const [eventId, catalogEvent] of catalogEvents.entries()) {
      const { camelCase, snakeCase } = catalogIdToMatchers(eventId);
      const domain = eventToDomain.get(eventId) ?? null;
      const ownerTeam = catalogEvent.owners[0] ?? null;

      // Strategy 1: Exact name match (CamelCase)
      let matchedEvents = db
        .prepare('SELECT id FROM events WHERE name = ?')
        .all(camelCase) as { id: number }[];

      // Strategy 2: Broad name match (LIKE)
      if (matchedEvents.length === 0) {
        matchedEvents = db
          .prepare("SELECT id FROM events WHERE name LIKE ?")
          .all(`%${camelCase}`) as { id: number }[];
      }

      // Strategy 3: Path match for Payload events
      if (matchedEvents.length === 0) {
        matchedEvents = db
          .prepare("SELECT id FROM events WHERE source_file LIKE ? AND name = 'Payload'")
          .all(`%${snakeCase}%`) as { id: number }[];
      }

      if (matchedEvents.length > 0) {
        for (const evt of matchedEvents) {
          updateEvent.run(domain, ownerTeam, evt.id);
        }
        matched += matchedEvents.length;
      } else {
        skipped++;
      }
    }
  });

  txn();

  console.log(
    `Event Catalog enrichment: ${matched} events enriched, ${skipped} catalog entries unmatched`,
  );

  return { matched, skipped };
}

/**
 * Find the EventCatalog src directory under rootDir.
 * Looks for fresha-event-catalog/src/.
 */
function findCatalogSrc(rootDir: string): string | null {
  // Check directly under rootDir
  const direct = path.join(rootDir, 'fresha-event-catalog', 'src');
  if (fs.existsSync(direct)) return direct;

  // Check one level deeper (rootDir might be the repos parent)
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(rootDir, entry.name, 'fresha-event-catalog', 'src');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // rootDir doesn't exist or not readable
  }

  return null;
}

/**
 * Parse domain MDX files to extract domain name and service IDs.
 */
function parseDomains(catalogSrc: string): Map<string, DomainInfo> {
  const domainsDir = path.join(catalogSrc, 'domains');
  const domains = new Map<string, DomainInfo>();

  if (!fs.existsSync(domainsDir)) return domains;

  try {
    const entries = fs.readdirSync(domainsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const mdxPath = path.join(domainsDir, entry.name, 'index.mdx');
      if (!fs.existsSync(mdxPath)) continue;

      try {
        const content = fs.readFileSync(mdxPath, 'utf-8');
        const fm = parseFrontmatter(content);
        const domainId = fm.id as string | undefined;
        const domainName = fm.name as string | undefined;
        const servicesList = fm.services as string[] | undefined;

        if (domainId && domainName) {
          // Extract service IDs from array items like "id: 's:service-name'"
          const serviceIds = (servicesList || []).map((s) => {
            const idMatch = s.match(/id:\s*'?([^'"\s]+)'?/);
            return idMatch ? idMatch[1] : s;
          });

          domains.set(domainId, { name: domainName, serviceIds });
        }
      } catch {
        // Skip unreadable domain files
      }
    }
  } catch {
    // domains dir not readable
  }

  return domains;
}

/**
 * Parse service MDX files to extract service ID and event IDs (sends).
 */
function parseServices(catalogSrc: string): Map<string, ServiceInfo> {
  const servicesDir = path.join(catalogSrc, 'services');
  const services = new Map<string, ServiceInfo>();

  if (!fs.existsSync(servicesDir)) return services;

  try {
    const entries = fs.readdirSync(servicesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const mdxPath = path.join(servicesDir, entry.name, 'index.mdx');
      if (!fs.existsSync(mdxPath)) continue;

      try {
        const content = fs.readFileSync(mdxPath, 'utf-8');
        const fm = parseFrontmatter(content);
        const serviceId = fm.id as string | undefined;
        const sendsList = fm.sends as string[] | undefined;

        if (serviceId) {
          // Extract event IDs from array items like "id: 'event:payment-failed'"
          const eventIds = (sendsList || []).map((s) => {
            const idMatch = s.match(/id:\s*'?([^'"\s]+)'?/);
            return idMatch ? idMatch[1] : s;
          });

          services.set(serviceId, { eventIds });
        }
      } catch {
        // Skip unreadable service files
      }
    }
  } catch {
    // services dir not readable
  }

  return services;
}

/**
 * Parse event MDX files to extract event ID and owners.
 */
function parseCatalogEvents(catalogSrc: string): Map<string, CatalogEvent> {
  const eventsDir = path.join(catalogSrc, 'events');
  const events = new Map<string, CatalogEvent>();

  if (!fs.existsSync(eventsDir)) return events;

  try {
    const entries = fs.readdirSync(eventsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const mdxPath = path.join(eventsDir, entry.name, 'index.mdx');
      if (!fs.existsSync(mdxPath)) continue;

      try {
        const content = fs.readFileSync(mdxPath, 'utf-8');
        const fm = parseFrontmatter(content);
        const eventId = fm.id as string | undefined;
        const owners = fm.owners as string[] | undefined;

        if (eventId) {
          events.set(eventId, {
            id: eventId,
            owners: owners || [],
          });
        }
      } catch {
        // Skip unreadable event files
      }
    }
  } catch {
    // events dir not readable
  }

  return events;
}

/**
 * Build a map from event ID -> domain name by traversing:
 * domain -> services -> events
 */
function buildEventDomainMap(
  domains: Map<string, DomainInfo>,
  services: Map<string, ServiceInfo>,
): Map<string, string> {
  const eventToDomain = new Map<string, string>();

  for (const [_domainId, domain] of domains) {
    for (const serviceId of domain.serviceIds) {
      const service = services.get(serviceId);
      if (!service) continue;

      for (const eventId of service.eventIds) {
        eventToDomain.set(eventId, domain.name);
      }
    }
  }

  return eventToDomain;
}
