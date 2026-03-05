import { describe, it, expect } from 'vitest';
import { tokenizeForFts } from '../../src/db/tokenizer.js';

describe('tokenizeForFts', () => {
  it('splits CamelCase into words', () => {
    expect(tokenizeForFts('BookingCreated')).toBe('booking created');
  });

  it('splits snake_case into words', () => {
    expect(tokenizeForFts('booking_service')).toBe('booking service');
  });

  it('splits dot-separated module names', () => {
    expect(tokenizeForFts('BookingContext.Commands.CreateBooking')).toBe(
      'booking context commands create booking',
    );
  });

  it('handles Elixir function arity notation', () => {
    expect(tokenizeForFts('handle_event/2')).toBe('handle event 2');
  });

  it('handles consecutive uppercase (acronyms)', () => {
    expect(tokenizeForFts('HTTPSServer')).toBe('https server');
    expect(tokenizeForFts('XMLParser')).toBe('xml parser');
  });

  it('handles mixed acronym and camelCase', () => {
    expect(tokenizeForFts('getHTTPSConnection')).toBe('get https connection');
  });

  it('handles empty string', () => {
    expect(tokenizeForFts('')).toBe('');
  });

  it('handles single word', () => {
    expect(tokenizeForFts('simple')).toBe('simple');
  });

  it('handles all caps', () => {
    expect(tokenizeForFts('ALLCAPS')).toBe('allcaps');
  });

  it('handles already separated words', () => {
    expect(tokenizeForFts('already separated words')).toBe('already separated words');
  });

  it('handles mixed separators', () => {
    expect(tokenizeForFts('mix_of.Everything')).toBe('mix of everything');
  });
});
