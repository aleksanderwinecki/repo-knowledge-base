import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopologyEdge } from '../../src/indexer/topology/types.js';

vi.mock('../../src/indexer/git.js', () => ({
  listWorkingTreeFiles: vi.fn(),
  readWorkingTreeFile: vi.fn(),
}));

import { listWorkingTreeFiles, readWorkingTreeFile } from '../../src/indexer/git.js';
import { extractGatewayEdges } from '../../src/indexer/topology/gateway.js';

const mockListFiles = vi.mocked(listWorkingTreeFiles);
const mockReadFile = vi.mocked(readWorkingTreeFile);

const SAMPLE_SERVICE_TS = `
import { describe } from '@graphql-mesh/compose';
export default describe({
  name: "Appointments",
  schemaSource: {
    repo: "app-appointments",
    branch: "main"
  }
});
`;

const SAMPLE_CATALOG_TS = `
import { describe } from '@graphql-mesh/compose';
export default describe({
  name: "Catalog",
  schemaSource: {
    repo: "app-catalog",
    branch: "main"
  }
});
`;

const NO_DESCRIBE_TS = `
import { something } from '@graphql-mesh/compose';
export const config = { port: 3000 };
`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractGatewayEdges', () => {
  it('detects describe() pattern and creates routes_to edge', () => {
    mockListFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'package.json',
    ]);
    mockReadFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual<TopologyEdge>({
      mechanism: 'gateway',
      sourceFile: 'compose/services/appointments.ts',
      targetServiceName: 'app-appointments',
      metadata: { serviceName: 'Appointments', repo: 'app-appointments' },
      confidence: 'medium',
    });
  });

  it('handles multiple service definitions in separate files', () => {
    mockListFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'compose/services/catalog.ts',
      'package.json',
    ]);
    mockReadFile
      .mockReturnValueOnce(SAMPLE_SERVICE_TS)
      .mockReturnValueOnce(SAMPLE_CATALOG_TS);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.targetServiceName).sort()).toEqual([
      'app-appointments',
      'app-catalog',
    ]);
    expect(edges[0]!.metadata.serviceName).toBe('Appointments');
    expect(edges[1]!.metadata.serviceName).toBe('Catalog');
  });

  it('returns empty array for repos without compose/services/ directory', () => {
    mockListFiles.mockReturnValue([
      'src/index.ts',
      'package.json',
      'lib/utils.ts',
    ]);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns empty array for repos with compose/services/*.ts but no describe() calls', () => {
    mockListFiles.mockReturnValue([
      'compose/services/config.ts',
    ]);
    mockReadFile.mockReturnValue(NO_DESCRIBE_TS);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toEqual([]);
  });

  it('extracts service name in metadata', () => {
    mockListFiles.mockReturnValue([
      'compose/services/appointments.ts',
    ]);
    mockReadFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges[0]!.metadata).toEqual({
      serviceName: 'Appointments',
      repo: 'app-appointments',
    });
  });

  it('only processes .ts files under compose/services/ path', () => {
    mockListFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'compose/other/thing.ts',
      'src/services/gateway.ts',
      'compose/services/nested/deep.ts',
    ]);
    mockReadFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo');

    // Should only read compose/services/appointments.ts (direct child, not nested)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith(
      '/fake/repo',
      'compose/services/appointments.ts',
    );
    expect(edges).toHaveLength(1);
  });

  it('handles multiline formatting variations', () => {
    const multilineVariation = `
import { describe } from '@graphql-mesh/compose';
export default describe({
  name:   "Payments"  ,
  schemaSource:   {
    repo:   "app-payments"  ,
    branch: "main"
  }
});
`;
    mockListFiles.mockReturnValue([
      'compose/services/payments.ts',
    ]);
    mockReadFile.mockReturnValue(multilineVariation);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetServiceName).toBe('app-payments');
    expect(edges[0]!.metadata.serviceName).toBe('Payments');
  });

  it('returns empty array when listWorkingTreeFiles returns empty', () => {
    mockListFiles.mockReturnValue([]);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toEqual([]);
  });

  it('handles null content from readWorkingTreeFile gracefully', () => {
    mockListFiles.mockReturnValue([
      'compose/services/broken.ts',
    ]);
    mockReadFile.mockReturnValue(null);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toEqual([]);
  });

  it('handles multiple describe() calls in a single file', () => {
    const multiDescribe = `
import { describe } from '@graphql-mesh/compose';
export const svc1 = describe({
  name: "Users",
  schemaSource: {
    repo: "app-users",
    branch: "main"
  }
});
export const svc2 = describe({
  name: "Accounts",
  schemaSource: {
    repo: "app-accounts",
    branch: "main"
  }
});
`;
    mockListFiles.mockReturnValue([
      'compose/services/multi.ts',
    ]);
    mockReadFile.mockReturnValue(multiDescribe);

    const edges = extractGatewayEdges('/fake/repo');

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.targetServiceName).sort()).toEqual([
      'app-accounts',
      'app-users',
    ]);
  });
});
