/**
 * CLI command: kb docs
 * Output command documentation (markdown) for AI discoverability.
 */

import type { Command } from '@commander-js/extra-typings';

const DOCS = `# kb -- Repository Knowledge Base CLI

JSON-only output for AI agents. All commands write JSON to stdout.

## Commands

### kb index
Index all repos under root directory.
\`\`\`bash
kb index                          # Index ~/Documents/Repos/
kb index --root /path/to/repos    # Custom root
kb index --force                  # Force re-index all
kb index --repo app-foo app-bar   # Reindex specific repos (always re-indexes)
\`\`\`

### kb search <query>
Full-text search across indexed knowledge.
\`\`\`bash
kb search "booking cancellation"           # Text search
kb search "BookingCreated" --entity        # Entity card with relationships
kb search "booking" --repo booking-service # Filter by repo
kb search "module" --type module           # Filter by entity type
kb search "billing" --limit 5             # Limit results
\`\`\`

### kb deps <entity>
Query service dependencies (direct neighbors).
\`\`\`bash
kb deps payments-service                   # Upstream dependencies
kb deps payments-service --direction downstream  # What depends on it
kb deps payments-service --repo booking-service  # Filter
\`\`\`

### kb learn <text>
Teach the knowledge base a new fact.
\`\`\`bash
kb learn "payments-service owns the billing domain"
kb learn "booking events use protobuf v3" --repo booking-service
\`\`\`

### kb learned
List all learned facts.
\`\`\`bash
kb learned                         # All facts
kb learned --repo payments-service # Filter by repo
\`\`\`

### kb forget <id>
Delete a learned fact by ID.
\`\`\`bash
kb forget 42
\`\`\`

### kb status
Show knowledge base statistics.
\`\`\`bash
kb status
\`\`\`

### kb impact <service>
Blast radius analysis: what services break if this service changes.
\`\`\`bash
kb impact app-payments                          # Full blast radius
kb impact app-payments --mechanism grpc         # Filter by communication type
kb impact app-payments --depth 2                # Limit traversal depth
\`\`\`

### kb trace <from> <to>
Shortest path between two services with mechanism labels per hop.
\`\`\`bash
kb trace app-checkout app-notifications
\`\`\`

### kb explain <service>
Structured service overview card — connections, events, modules, hints.
\`\`\`bash
kb explain app-appointments
\`\`\`

### kb field-impact <field>
Trace a field across service boundaries with nullability at each hop.
\`\`\`bash
kb field-impact employee_id                     # Trace field through all services
\`\`\`

### kb docs
Show this documentation.
\`\`\`bash
kb docs
\`\`\`

## Environment

- \`KB_DB_PATH\`: Override database location (default: ~/.kb/knowledge.db)

## Output Format

All commands output JSON. Errors go to stderr as JSON with \`error\` and \`code\` fields.
`;

export function registerDocs(program: Command) {
  program
    .command('docs')
    .description('Output command documentation (markdown)')
    .action(() => {
      // Docs command outputs raw markdown, not JSON -- it's documentation, not data
      process.stdout.write(DOCS);
    });
}
