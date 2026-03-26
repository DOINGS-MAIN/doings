/**
 * AML same-name verification.
 * Normalizes and compares names accounting for ordering differences,
 * extra whitespace, and case. Returns a confidence score 0–1.
 */

function normalize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

export function nameMatchScore(nameA: string, nameB: string): number {
  const partsA = normalize(nameA);
  const partsB = normalize(nameB);

  if (partsA.length === 0 || partsB.length === 0) return 0;

  const [shorter, longer] =
    partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];

  let matched = 0;
  const used = new Set<number>();

  for (const word of shorter) {
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && longer[i] === word) {
        matched++;
        used.add(i);
        break;
      }
    }
  }

  return matched / Math.max(partsA.length, partsB.length);
}

/**
 * Passes if at least 2 name tokens match (covers first+last even if
 * middle name differs or is missing on one side). Threshold: >= 0.6
 */
export function isSamePersonName(verifiedName: string, bankName: string): boolean {
  const score = nameMatchScore(verifiedName, bankName);
  const partsA = normalize(verifiedName);
  const partsB = normalize(bankName);

  const [shorter, longer] =
    partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];
  let matchedCount = 0;
  const used = new Set<number>();
  for (const word of shorter) {
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && longer[i] === word) {
        matchedCount++;
        used.add(i);
        break;
      }
    }
  }

  return matchedCount >= 2 && score >= 0.6;
}
