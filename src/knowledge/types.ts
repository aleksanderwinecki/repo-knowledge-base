/** A manually injected fact in the knowledge base. */
export interface LearnedFact {
  id: number;
  content: string;
  repo: string | null;
  createdAt: string;
}
