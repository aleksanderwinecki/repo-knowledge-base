import { listBranchFiles, readBranchFile } from '../git.js';
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

/** Module attribute holding topic name */
const TOPIC_ATTR_RE = /@topic_name\s+"([\w.-]+)"/g;

/** Producer confirmation: Kafkaesque.Producer or Outbox.emit usage */
const PRODUCER_CONFIRM_RE =
  /Kafkaesque\.Producer\.produce_batch|Outbox\.emit/;

/** Consumer via Kafkaesque.Consumer or OneOffConsumer with topics_config map keys */
const CONSUMER_USE_RE =
  /use\s+Kafkaesque\.(?:Consumer|OneOffConsumer)/;

/** Topic names as map keys in topics_config: %{ "topic.name" => ... } */
const TOPICS_CONFIG_MAP_RE = /"([\w.-]+)"\s*=>\s*%\{/g;

/** ConsumerSupervisor variant: topics: ["topic.name"] */
const TOPICS_LIST_RE = /topics:\s*\["([\w.-]+)"\]/g;

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
 * Extract Kafka producer/consumer edges from an Elixir repo.
 *
 * Producer patterns:
 *   - @topic_name module attribute + Kafkaesque.Producer or Outbox.emit in same file
 *
 * Consumer patterns:
 *   - use Kafkaesque.Consumer/OneOffConsumer with topics_config map keys
 *   - use Kafkaesque.ConsumerSupervisor with topics: ["..."] list
 *
 * Returns TopologyEdge[] — pure data, no DB access.
 * These are NEW produces_kafka/consumes_kafka edge types, complementary to
 * existing produces_event/consumes_event (which are proto-message-centric).
 */
export function extractKafkaEdges(
  repoPath: string,
  branch: string,
): TopologyEdge[] {
  const allFiles = listBranchFiles(repoPath, branch);
  const exFiles = allFiles.filter(
    (f) => f.endsWith('.ex') && LIB_PATH_PATTERNS.some((p) => p.test(f)) && !isTestPath(f),
  );

  const edges: TopologyEdge[] = [];

  for (const filePath of exFiles) {
    const content = readBranchFile(repoPath, branch, filePath);
    if (!content) continue;

    // --- Producer detection ---
    // Find @topic_name attributes and confirm with producer patterns in same file
    const hasProducerPattern = PRODUCER_CONFIRM_RE.test(content);

    if (hasProducerPattern) {
      TOPIC_ATTR_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TOPIC_ATTR_RE.exec(content)) !== null) {
        const topic = match[1]!;
        edges.push({
          mechanism: 'kafka',
          sourceFile: filePath,
          targetServiceName: topic,
          metadata: { topic, role: 'producer' },
          confidence: 'high',
        });
      }
    }

    // --- Consumer detection ---
    const isConsumer = CONSUMER_USE_RE.test(content);

    if (isConsumer) {
      // Pattern: topics_config map keys
      TOPICS_CONFIG_MAP_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TOPICS_CONFIG_MAP_RE.exec(content)) !== null) {
        const topic = match[1]!;
        edges.push({
          mechanism: 'kafka',
          sourceFile: filePath,
          targetServiceName: topic,
          metadata: { topic, role: 'consumer' },
          confidence: 'high',
        });
      }
    }

    // ConsumerSupervisor topics: ["..."] variant (matches even without `use Kafkaesque.Consumer`)
    TOPICS_LIST_RE.lastIndex = 0;
    let topicMatch: RegExpExecArray | null;
    while ((topicMatch = TOPICS_LIST_RE.exec(content)) !== null) {
      const topic = topicMatch[1]!;
      // Avoid duplicates from topics_config pattern
      if (!edges.some((e) => e.sourceFile === filePath && e.metadata.topic === topic && e.metadata.role === 'consumer')) {
        edges.push({
          mechanism: 'kafka',
          sourceFile: filePath,
          targetServiceName: topic,
          metadata: { topic, role: 'consumer' },
          confidence: 'high',
        });
      }
    }
  }

  return edges;
}
