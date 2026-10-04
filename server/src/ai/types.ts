/** Provider-agnostic extractor. Returns RAW (unvalidated) JSON — the service validates it. */
export interface AiExtractor {
  readonly name: string;
  extractContract(documentText: string, retryHint?: string): Promise<unknown>;
  analyzePolicy(contractText: string, policyText: string, retryHint?: string): Promise<unknown>;
}
