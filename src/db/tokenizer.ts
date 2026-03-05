/**
 * Preprocess text for FTS5 indexing.
 * Splits CamelCase, snake_case, and dot-separated identifiers into space-separated lowercase words.
 *
 * Examples:
 *   "BookingCreated" → "booking created"
 *   "booking_service" → "booking service"
 *   "BookingContext.Commands.CreateBooking" → "booking context commands create booking"
 *   "HTTPSServer" → "https server"
 *   "getHTTPSConnection" → "get https connection"
 */
export function tokenizeForFts(text: string): string {
  if (!text) return '';

  return (
    text
      // Split CamelCase: insert space before uppercase preceded by lowercase/digit
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // Split acronyms: insert space between consecutive uppercase followed by uppercase+lowercase
      // e.g., HTTPSServer → HTTPS Server, XMLParser → XML Parser
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // Replace common separators with spaces
      .replace(/[_./\\]/g, ' ')
      // Replace other non-alphanumeric characters with spaces
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}
