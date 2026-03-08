import { describe, it, expect } from 'vitest';
import { composeEmbeddingText } from '../../src/embeddings/text.js';

describe('composeEmbeddingText', () => {
  describe('module entity type', () => {
    it('composes name, type, and summary', () => {
      const result = composeEmbeddingText({
        entityType: 'module',
        entityId: 1,
        name: 'BookingContext.Commands.CreateBooking',
        type: 'context',
        summary: 'Creates a booking for a customer',
      });
      expect(result).toBe('booking context commands create booking context creates a booking for a customer');
    });

    it('skips null fields', () => {
      const result = composeEmbeddingText({
        entityType: 'module',
        entityId: 1,
        name: 'BookingContext',
        type: null,
        summary: null,
      });
      expect(result).toBe('booking context');
    });
  });

  describe('event entity type', () => {
    it('composes name and schema definition', () => {
      const result = composeEmbeddingText({
        entityType: 'event',
        entityId: 2,
        name: 'BookingCreated',
        schemaDefinition: 'message BookingCreated { string booking_id; string customer_id }',
      });
      expect(result).toBeTruthy();
      expect(result!.includes('booking created')).toBe(true);
      expect(result!.includes('booking id')).toBe(true);
      expect(result!.includes('customer id')).toBe(true);
    });
  });

  describe('service entity type', () => {
    it('composes name and description', () => {
      const result = composeEmbeddingText({
        entityType: 'service',
        entityId: 3,
        name: 'BookingService',
        description: 'gRPC service with RPCs: CreateBooking(CreateBookingRequest) -> CreateBookingReply',
      });
      expect(result).toBeTruthy();
      expect(result!.includes('booking service')).toBe(true);
      expect(result!.includes('create booking')).toBe(true);
    });
  });

  describe('repo entity type', () => {
    it('composes name and description', () => {
      const result = composeEmbeddingText({
        entityType: 'repo',
        entityId: 4,
        name: 'app-bookings',
        description: 'Booking management service',
      });
      expect(result).toBe('app bookings booking management service');
    });
  });

  describe('learned_fact entity type', () => {
    it('composes content and repo', () => {
      const result = composeEmbeddingText({
        entityType: 'learned_fact',
        entityId: 5,
        content: 'Bookings use soft deletes',
        repo: 'app-bookings',
      });
      expect(result).toBe('bookings use soft deletes app bookings');
    });
  });

  describe('edge cases', () => {
    it('returns null for unknown entity type', () => {
      const result = composeEmbeddingText({
        entityType: 'unknown',
        entityId: 99,
        name: 'Something',
      });
      expect(result).toBeNull();
    });

    it('returns null when all optional fields are null', () => {
      const result = composeEmbeddingText({
        entityType: 'module',
        entityId: 1,
        name: null,
        type: null,
        summary: null,
      });
      expect(result).toBeNull();
    });

    it('returns null when all optional fields are undefined', () => {
      const result = composeEmbeddingText({
        entityType: 'module',
        entityId: 1,
      });
      expect(result).toBeNull();
    });

    it('output is lowercased (tokenizeForFts effect)', () => {
      const result = composeEmbeddingText({
        entityType: 'repo',
        entityId: 1,
        name: 'MyRepo',
        description: 'A Test Service',
      });
      expect(result).toBe('my repo a test service');
    });

    it('CamelCase splitting works through composition', () => {
      const result = composeEmbeddingText({
        entityType: 'module',
        entityId: 1,
        name: 'BookingContext',
      });
      expect(result).toBe('booking context');
    });

    it('empty string fields are skipped', () => {
      const result = composeEmbeddingText({
        entityType: 'repo',
        entityId: 1,
        name: 'test',
        description: '',
      });
      expect(result).toBe('test');
    });
  });
});
