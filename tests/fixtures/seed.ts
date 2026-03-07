/**
 * Shared realistic test data for golden query and snapshot tests.
 * Seeds 2 repos with modules, events, services, and learned facts.
 */

import type Database from 'better-sqlite3';
import { persistRepoData } from '../../src/indexer/writer.js';
import { learnFact } from '../../src/knowledge/store.js';

/**
 * Seed a test database with realistic multi-repo data.
 *
 * Repos:
 *   - booking-service: 2 modules, 1 event
 *   - payments-service: 3 modules, 1 service
 *
 * Learned facts: 2 (one repo-scoped, one global)
 */
export function seedTestData(db: Database.Database): void {
  // Repo 1: booking-service
  persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles hotel booking and cancellation',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'abc123',
    },
    modules: [
      {
        name: 'BookingContext.Commands.CreateBooking',
        type: 'context',
        filePath: 'lib/booking_context/commands/create_booking.ex',
        summary: 'Handles booking creation and validation logic',
      },
      {
        name: 'BookingContext.Cancellation',
        type: 'module',
        filePath: 'lib/booking_context/cancellation.ex',
        summary: 'Manages booking cancellation workflows and refund calculation',
      },
    ],
    events: [
      {
        name: 'BookingCreated',
        schemaDefinition:
          'message BookingCreated { string booking_id = 1; string guest_name = 2; }',
        sourceFile: 'proto/booking.proto',
      },
    ],
  });

  // Repo 2: payments-service
  persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing and billing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'def456',
    },
    modules: [
      {
        name: 'PaymentProcessor',
        type: 'module',
        filePath: 'lib/payment_processor.ex',
        summary: 'Processes payments after booking confirmation',
      },
      {
        name: 'Payments.Schema.Transaction',
        type: 'schema',
        filePath: 'lib/payments/schema/transaction.ex',
        summary: 'Ecto schema for payment transactions',
        tableName: 'transactions',
      },
      {
        name: 'Payments.Queries.GetTransaction',
        type: 'graphql_query',
        filePath: 'lib/payments/queries/get_transaction.ex',
        summary: 'GraphQL query resolver for transactions',
      },
    ],
    services: [
      {
        name: 'PaymentGateway',
        description: 'gRPC payment gateway service for processing charges',
        serviceType: 'grpc',
      },
    ],
  });

  // Learned facts
  learnFact(db, 'payments-service uses Stripe API for charge processing', 'payments-service');
  learnFact(db, 'booking-service sends BookingCreated events via Kafka');
}
