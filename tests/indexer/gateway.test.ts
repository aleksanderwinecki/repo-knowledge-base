import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopologyEdge } from '../../src/indexer/topology/types.js';

vi.mock('../../src/indexer/git.js', () => ({
  listBranchFiles: vi.fn(),
  readBranchFile: vi.fn(),
}));

import { listBranchFiles, readBranchFile } from '../../src/indexer/git.js';
import { extractGatewayEdges } from '../../src/indexer/topology/gateway.js';

const mockListBranchFiles = vi.mocked(listBranchFiles);
const mockReadBranchFile = vi.mocked(readBranchFile);

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
    mockListBranchFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'package.json',
    ]);
    mockReadBranchFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo', 'main');

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
    mockListBranchFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'compose/services/catalog.ts',
      'package.json',
    ]);
    mockReadBranchFile
      .mockReturnValueOnce(SAMPLE_SERVICE_TS)
      .mockReturnValueOnce(SAMPLE_CATALOG_TS);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.targetServiceName).sort()).toEqual([
      'app-appointments',
      'app-catalog',
    ]);
    expect(edges[0]!.metadata.serviceName).toBe('Appointments');
    expect(edges[1]!.metadata.serviceName).toBe('Catalog');
  });

  it('returns empty array for repos without compose/services/ directory', () => {
    mockListBranchFiles.mockReturnValue([
      'src/index.ts',
      'package.json',
      'lib/utils.ts',
    ]);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toEqual([]);
    expect(mockReadBranchFile).not.toHaveBeenCalled();
  });

  it('returns empty array for repos with compose/services/*.ts but no describe() calls', () => {
    mockListBranchFiles.mockReturnValue([
      'compose/services/config.ts',
    ]);
    mockReadBranchFile.mockReturnValue(NO_DESCRIBE_TS);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toEqual([]);
  });

  it('extracts service name in metadata', () => {
    mockListBranchFiles.mockReturnValue([
      'compose/services/appointments.ts',
    ]);
    mockReadBranchFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges[0]!.metadata).toEqual({
      serviceName: 'Appointments',
      repo: 'app-appointments',
    });
  });

  it('only processes .ts files under compose/services/ path', () => {
    mockListBranchFiles.mockReturnValue([
      'compose/services/appointments.ts',
      'compose/other/thing.ts',
      'src/services/gateway.ts',
      'compose/services/nested/deep.ts',
    ]);
    mockReadBranchFile.mockReturnValue(SAMPLE_SERVICE_TS);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    // Should only read compose/services/appointments.ts (direct child, not nested)
    expect(mockReadBranchFile).toHaveBeenCalledTimes(1);
    expect(mockReadBranchFile).toHaveBeenCalledWith(
      '/fake/repo',
      'main',
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
    mockListBranchFiles.mockReturnValue([
      'compose/services/payments.ts',
    ]);
    mockReadBranchFile.mockReturnValue(multilineVariation);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetServiceName).toBe('app-payments');
    expect(edges[0]!.metadata.serviceName).toBe('Payments');
  });

  it('returns empty array when listBranchFiles returns empty', () => {
    mockListBranchFiles.mockReturnValue([]);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toEqual([]);
  });

  it('handles null content from readBranchFile gracefully', () => {
    mockListBranchFiles.mockReturnValue([
      'compose/services/broken.ts',
    ]);
    mockReadBranchFile.mockReturnValue(null);

    const edges = extractGatewayEdges('/fake/repo', 'main');

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
    mockListBranchFiles.mockReturnValue([
      'compose/services/multi.ts',
    ]);
    mockReadBranchFile.mockReturnValue(multiDescribe);

    const edges = extractGatewayEdges('/fake/repo', 'main');

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.targetServiceName).sort()).toEqual([
      'app-accounts',
      'app-users',
    ]);
  });
});
